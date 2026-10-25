"""Stateless retrieval + generation. No document writes or conversation persistence."""

from threading import BoundedSemaphore
from time import monotonic

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import api_error
from app.schemas.chat import ChatRequest, ChatResponse, ChatTimings
from app.schemas.search import SearchRequest
from app.services.embeddings import EmbeddingClient
from app.services.llm import LLMClient, LLMFailure
from app.services.rag_context import SYSTEM_INSTRUCTIONS, assemble_context, source_payload
from app.services.search import SemanticSearch

INSUFFICIENT = (
    "The selected documents do not provide enough usable evidence to answer this question. "
    "Check the filters, process and index your PDFs, or ask a more specific question."
)
LLM_ERRORS = {
    "chat_busy": (409, "A document answer is already being generated; try again shortly."),
    "chat_unavailable": (503, "Ollama is unavailable. Start Ollama and retry."),
    "chat_model_missing": (503, "The configured chat model is unavailable. Check Ollama models."),
    "generation_timeout": (
        504,
        "Answer generation timed out. Ollama may be loading; retry shortly.",
    ),
    "invalid_generation": (502, "Ollama returned an invalid or incomplete answer. Please retry."),
    "chat_context_too_large": (422, "The question exceeds the configured chat context budget."),
    "generation_failed": (503, "Ollama could not generate an answer. Check the local service."),
}


class RAGEngine:
    def __init__(self, settings: Settings):
        self.settings = settings
        # Admission covers retrieval too; no unbounded queue of pending generations.
        self.slot = BoundedSemaphore(1)

    def run(
        self,
        session: Session,
        embeddings: EmbeddingClient,
        search: SemanticSearch,
        llm: LLMClient,
        body: ChatRequest,
    ) -> ChatResponse:
        if not self.slot.acquire(blocking=False):
            raise api_error(409, "chat_busy", LLM_ERRORS["chat_busy"][1])
        started = monotonic()
        try:
            minimum_input = len(SYSTEM_INSTRUCTIONS.encode()) + len(
                source_payload(body.question, []).encode()
            )
            if minimum_input > (
                self.settings.chat_context_tokens - self.settings.chat_response_tokens - 128
            ):
                raise LLMFailure("chat_context_too_large")
            retrieval_started = monotonic()
            result = search.run(
                session,
                embeddings,
                SearchRequest(
                    query=body.question,
                    collection_id=body.collection_id,
                    document_id=body.document_id,
                    top_k=body.top_k or self.settings.rag_top_k,
                ),
            )
            # Release the read transaction/connection before a slow Ollama generation.
            session.rollback()
            retrieval_ms = (monotonic() - retrieval_started) * 1000
            sources, messages = assemble_context(self.settings, body, result.items)
            generation_ms = 0.0
            status, answer = "insufficient_evidence", INSUFFICIENT
            if sources:
                generation_started = monotonic()
                generated = llm.generate(messages)
                generation_ms = (monotonic() - generation_started) * 1000
                status = generated.status
                if status == "answered":
                    answer = generated.answer.strip()
            return ChatResponse(
                status=status,
                answer=answer,
                sources=sources,
                chat_model=self.settings.ollama_chat_model,
                embedding_model=result.model,
                retrieval_count=len(result.items),
                context_count=len(sources),
                incompatible_documents=result.incompatible_documents,
                timings=ChatTimings(
                    retrieval_ms=round(retrieval_ms, 2),
                    generation_ms=round(generation_ms, 2),
                    total_ms=round((monotonic() - started) * 1000, 2),
                ),
            )
        except LLMFailure as exc:
            code = exc.code if exc.code in LLM_ERRORS else "generation_failed"
            http_status, message = LLM_ERRORS[code]
            raise api_error(http_status, code, message) from None
        finally:
            self.slot.release()


def get_rag(request: Request) -> RAGEngine:
    return request.app.state.rag
