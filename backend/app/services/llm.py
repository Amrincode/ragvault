"""Bounded non-streaming Ollama chat. Never log prompts, bodies or provider errors."""

import json
from threading import BoundedSemaphore
from time import monotonic
from typing import Literal

import httpx
from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.core.config import Settings
from app.services.embeddings import canonical_model


class LLMFailure(Exception):
    def __init__(self, code: str = "generation_failed"):
        self.code = code
        super().__init__(code)


class GeneratedCitation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    citation_id: str = Field(min_length=1, max_length=80)
    quote: str = Field(max_length=400)

    @field_validator("citation_id", "quote")
    @classmethod
    def valid_text(cls, value: str) -> str:
        value.encode("utf-8")
        if any(ord(c) < 32 and c not in "\n\t\r" for c in value):
            raise ValueError("Invalid control characters")
        return value


class GeneratedClaim(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    text: str = Field(min_length=1, max_length=400)
    citations: list[GeneratedCitation] = Field(max_length=3)

    @field_validator("text")
    @classmethod
    def valid_text(cls, value: str) -> str:
        return GeneratedCitation.valid_text(value)


class GeneratedAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    status: Literal["answered", "partial", "insufficient_evidence"]
    claims: list[GeneratedClaim] = Field(max_length=6)


class EvidenceSelection(BaseModel):
    """Model selects evidence only; no independently generated claim text to repair."""

    model_config = ConfigDict(extra="forbid", strict=True)

    citations: list[GeneratedCitation] = Field(min_length=1, max_length=3)


class SelectedAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    status: Literal["answered", "partial", "insufficient_evidence"]
    claims: list[EvidenceSelection] = Field(max_length=6)


class LLMClient:
    def __init__(self, client: httpx.Client, settings: Settings):
        self.client = client
        self.settings = settings
        self.slot = BoundedSemaphore(1)

    def generate(self, messages: list[dict[str, str]]) -> GeneratedAnswer:
        if not self.slot.acquire(blocking=False):
            raise LLMFailure("chat_busy")
        config = self.settings
        deadline = monotonic() + config.chat_generation_timeout_seconds
        try:
            # One UTF-8 byte per token is deliberately conservative, not a tokenizer.
            if sum(len(m["content"].encode("utf-8")) for m in messages) > (
                config.chat_context_tokens - config.chat_response_tokens - 128
            ):
                raise LLMFailure("chat_context_too_large")
            schema = SelectedAnswer.model_json_schema()
            with self.client.stream(
                "POST",
                "api/chat",
                json={
                    "model": config.ollama_chat_model,
                    "messages": messages,
                    "stream": False,
                    "format": schema,
                    "keep_alive": "2m",
                    "options": {
                        "temperature": 0,
                        "num_ctx": config.chat_context_tokens,
                        "num_predict": config.chat_response_tokens,
                    },
                },
                timeout=httpx.Timeout(
                    config.chat_generation_timeout_seconds,
                    connect=config.chat_connect_timeout_seconds,
                    write=5,
                    pool=1,
                ),
            ) as response:
                if response.status_code == 404:
                    raise LLMFailure("chat_model_missing")
                response.raise_for_status()
                body = bytearray()
                for part in response.iter_bytes():
                    if monotonic() > deadline:
                        raise LLMFailure("generation_timeout")
                    body.extend(part)
                    if len(body) > 65536:
                        raise LLMFailure("invalid_generation")
                data = json.loads(body)
            if (
                data.get("done") is not True
                or data.get("done_reason") != "stop"
                or canonical_model(data["model"]) != canonical_model(config.ollama_chat_model)
                or data["message"]["role"] != "assistant"
                or data["message"].get("tool_calls")
                or data.get("error")
            ):
                raise LLMFailure("invalid_generation")
            selected = SelectedAnswer.model_validate_json(data["message"]["content"])
            # Explicit extractive contract: these are untrusted selections until the
            # citation verifier checks aliases, quotations, scope and numerical wording.
            result = GeneratedAnswer(
                status=selected.status,
                claims=[
                    GeneratedClaim(text=item.citations[0].quote, citations=item.citations)
                    for item in selected.claims
                ],
            )
            if (
                any(not claim.text.strip() for claim in result.claims)
                or sum(len(claim.text) + 5 * len(claim.citations) + 2 for claim in result.claims)
                > config.chat_max_answer_chars
            ):
                raise LLMFailure("invalid_generation")
            return result
        except httpx.TimeoutException:
            raise LLMFailure("generation_timeout") from None
        except httpx.ConnectError:
            raise LLMFailure("chat_unavailable") from None
        except httpx.HTTPError:
            raise LLMFailure() from None
        except (ValueError, KeyError, TypeError, AttributeError, ValidationError, RecursionError):
            raise LLMFailure("invalid_generation") from None
        finally:
            self.slot.release()


def get_llm(request: Request) -> LLMClient:
    return request.app.state.llm
