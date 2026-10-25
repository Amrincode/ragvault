"""Stateless retrieval + generation. No document writes or conversation persistence."""

import re
from threading import BoundedSemaphore
from time import monotonic

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import api_error
from app.schemas.chat import ChatRequest, ChatResponse, ChatTimings, CitationVerification
from app.schemas.search import SearchRequest
from app.services.citations import CitationVerifier, verify_claims
from app.services.embeddings import EmbeddingClient
from app.services.evidence_focus import focus_question, page_limit_question, requested_category
from app.services.llm import GeneratedAnswer, LLMClient, LLMFailure
from app.services.rag_context import assemble_context, source_payload, system_instructions
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
        verifier: CitationVerifier,
        *,
        history: list[str] | None = None,
        retrieval_query: str | None = None,
    ) -> ChatResponse:
        if not self.slot.acquire(blocking=False):
            raise api_error(409, "chat_busy", LLM_ERRORS["chat_busy"][1])
        started = monotonic()
        try:
            minimum_input = len(system_instructions(history).encode()) + len(
                source_payload(body.question, [], history).encode()
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
                    query=retrieval_query or body.question,
                    collection_id=body.collection_id,
                    document_id=body.document_id,
                    top_k=body.top_k or self.settings.rag_top_k,
                ),
            )
            # Release the read transaction/connection before a slow Ollama generation.
            session.rollback()
            retrieval_ms = (monotonic() - retrieval_started) * 1000
            sources, messages = assemble_context(self.settings, body, result.items, history=history)
            focused_question = focus_question(body.question, history)
            unresolved = bool(
                re.search(r"\b(its|it)\b", body.question, re.I)
                and page_limit_question(body.question)
                and not requested_category(focused_question)
            )
            generation_ms = 0.0
            verification_ms = 0.0
            claims = []
            verification = CitationVerification()
            status, answer = "insufficient_evidence", INSUFFICIENT
            if sources:
                verification_started = monotonic()
                verifier.check_sources(session, sources, body, result.model, result.dimensions)
                verification_ms += (monotonic() - verification_started) * 1000
                generation_started = monotonic()
                generated = (
                    GeneratedAnswer(status="insufficient_evidence", claims=[])
                    if unresolved
                    else llm.generate(messages)
                )
                generation_ms = (monotonic() - generation_started) * 1000
                verification_started = monotonic()
                verifier.check_sources(session, sources, body, result.model, result.dimensions)
                if generated.status != "insufficient_evidence":
                    claims = verify_claims(
                        generated, sources, focus_question(body.question, history)
                    )
                    accepted = [c for c in claims if c.status == "potentially_supported"]
                    withheld = len(claims) - len(accepted)
                    verification = CitationVerification(
                        status="issues_found"
                        if withheld or not accepted
                        else "source_checks_passed",
                        accepted_claims=len(accepted),
                        withheld_claims=withheld,
                    )
                    if accepted:
                        status = (
                            "partial" if withheld or generated.status == "partial" else "answered"
                        )
                        answer = "\n\n".join(
                            claim.text
                            + " "
                            + " ".join(
                                f"[{number}]"
                                for number in dict.fromkeys(c.number for c in claim.citations)
                            )
                            for claim in accepted
                        )
                    else:
                        status = "unreliable"
                        answer = (
                            "No generated claims passed the citation and wording checks. "
                            "Review the source passages or ask a more specific question."
                        )
                verification_ms += (monotonic() - verification_started) * 1000
                if generated.status == "insufficient_evidence":
                    answer = (
                        "Which report or category do you mean? Ask an explicit question or refer "
                        "to a preceding category question in this conversation."
                        if unresolved
                        else "Source passages were retrieved, but the model did not select "
                        "a usable answer. "
                        "Review the retrieved excerpts or ask a more specific question."
                    )
            return ChatResponse(
                status=status,
                answer=answer,
                sources=sources,
                chat_model=self.settings.ollama_chat_model,
                embedding_model=result.model,
                embedding_dimensions=result.dimensions,
                retrieval_count=len(result.items),
                context_count=len(sources),
                incompatible_documents=result.incompatible_documents,
                timings=ChatTimings(
                    retrieval_ms=round(retrieval_ms, 2),
                    generation_ms=round(generation_ms, 2),
                    total_ms=round((monotonic() - started) * 1000, 2),
                    verification_ms=round(verification_ms, 2),
                ),
                claims=claims,
                verification=verification,
                evidence_fallback=[
                    s.model_copy(update={"excerpt": s.excerpt[:600]}) for s in sources[:2]
                ]
                if status in {"unreliable", "insufficient_evidence"}
                else [],
            )
        except LLMFailure as exc:
            code = exc.code if exc.code in LLM_ERRORS else "generation_failed"
            http_status, message = LLM_ERRORS[code]
            raise api_error(http_status, code, message) from None
        finally:
            self.slot.release()


def get_rag(request: Request) -> RAGEngine:
    return request.app.state.rag
