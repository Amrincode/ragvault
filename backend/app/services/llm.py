"""Bounded non-streaming Ollama chat. Never log prompts, bodies or provider errors."""

import json
from threading import BoundedSemaphore
from time import monotonic
from typing import Literal

import httpx
from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.config import Settings
from app.services.embeddings import canonical_model


class LLMFailure(Exception):
    def __init__(self, code: str = "generation_failed"):
        self.code = code
        super().__init__(code)


class GeneratedAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    status: Literal["answered", "insufficient_evidence"]
    answer: str = Field(min_length=1, max_length=12000)


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
            schema = GeneratedAnswer.model_json_schema()
            schema["properties"]["answer"]["maxLength"] = config.chat_max_answer_chars
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
            result = GeneratedAnswer.model_validate_json(data["message"]["content"])
            if not result.answer.strip() or len(result.answer) > config.chat_max_answer_chars:
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
