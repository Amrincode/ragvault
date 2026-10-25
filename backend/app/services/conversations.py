"""Durable ordered turns; history supplies topics, never evidence or assistant facts."""

import json
import re
from datetime import UTC, timedelta
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, aliased

from app.core.config import Settings
from app.core.errors import api_error
from app.models import Collection, Conversation, Document, Message
from app.models.library import utc_now
from app.schemas.chat import ChatRequest, ChatResponse, ChatSource
from app.schemas.conversations import (
    ConversationResponse,
    MessageResponse,
    TurnRequest,
    TurnResponse,
)
from app.services.citations import CitationVerifier


def require_conversation(session: Session, identifier: UUID) -> Conversation:
    item = session.get(Conversation, identifier)
    if item is None:
        raise api_error(404, "conversation_not_found", "Conversation not found")
    return item


def scope_available(session: Session, item: Conversation) -> bool:
    if item.scope_collection_id and session.get(Collection, item.scope_collection_id) is None:
        return False
    if item.scope_document_id:
        doc = session.get(Document, item.scope_document_id)
        if doc is None or (
            item.scope_collection_id and doc.collection_id != item.scope_collection_id
        ):
            return False
    return True


def describe(session: Session, item: Conversation) -> ConversationResponse:
    labels = []
    if item.scope_collection_id:
        group = session.get(Collection, item.scope_collection_id)
        labels.append("Collection: " + (group.name if group else "unavailable"))
    if item.scope_document_id:
        doc = session.get(Document, item.scope_document_id)
        labels.append("Document: " + (doc.filename if doc else "unavailable"))
    return ConversationResponse(
        id=item.id,
        title=item.title,
        collection_id=item.scope_collection_id,
        document_id=item.scope_document_id,
        scope_available=scope_available(session, item),
        generating=item.active_request_id is not None,
        scope_label=" · ".join(labels) if labels else "All indexed PDFs",
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def recover_expired(session: Session, item: Conversation, settings: Settings) -> None:
    lease = settings.chat_generation_timeout_seconds + settings.embedding_timeout_seconds + 60
    cutoff = utc_now() - timedelta(seconds=lease)
    started = item.active_started_at
    if not item.active_request_id or not started:
        return
    started = started.replace(tzinfo=UTC) if started.tzinfo is None else started.astimezone(UTC)
    if started > cutoff:
        return
    request_id = item.active_request_id
    changed = session.execute(
        update(Conversation)
        .where(
            Conversation.id == item.id,
            Conversation.active_request_id == request_id,
            Conversation.active_started_at <= cutoff,
        )
        .execution_options(synchronize_session=False)
        .values(active_request_id=None, active_started_at=None, updated_at=utc_now())
    )
    if changed.rowcount:
        session.execute(
            update(Message)
            .where(
                Message.conversation_id == item.id,
                Message.request_id == request_id,
                Message.role == "assistant",
                Message.status == "pending",
            )
            .values(
                status="failed",
                content="Generation was interrupted. Retry with a new request key.",
                error_code="generation_interrupted",
            )
        )
    session.commit()
    session.refresh(item)


def rename(session: Session, item: Conversation, title: str) -> None:
    result = session.execute(
        update(Conversation)
        .where(
            Conversation.id == item.id,
            Conversation.active_request_id.is_(None),
        )
        .values(title=title, updated_at=utc_now())
    )
    if not result.rowcount:
        session.rollback()
        raise api_error(409, "conversation_busy", "Wait for this conversation's active question")
    session.commit()


def remove(session: Session, item: Conversation) -> None:
    result = session.execute(
        delete(Conversation).where(
            Conversation.id == item.id,
            Conversation.active_request_id.is_(None),
        )
    )
    if not result.rowcount:
        session.rollback()
        raise api_error(409, "conversation_busy", "Wait for this conversation's active question")
    session.commit()


def conversation_topics(session: Session, item: Conversation, question: str, settings: Settings):
    if not re.search(
        r"\b(those|these|them|that|it|its|which|mandatory|optional|more)\b|what about|how about",
        question,
        re.I,
    ):
        return [], question
    assistant = aliased(Message)
    rows = session.scalars(
        select(Message.content)
        .where(
            Message.conversation_id == item.id,
            Message.role == "user",
            exists(
                select(assistant.id).where(
                    assistant.conversation_id == Message.conversation_id,
                    assistant.request_id == Message.request_id,
                    assistant.role == "assistant",
                    assistant.status == "complete",
                )
            ),
        )
        .order_by(Message.position.desc())
        .limit(settings.conversation_history_messages)
    ).all()
    remaining = settings.conversation_history_chars
    topics = []
    for text in rows:
        if remaining <= 0:
            break
        topic = text[: min(300, remaining)]
        topics.append(topic)
        remaining -= len(topic)
    topics.reverse()
    query = question
    if topics:
        query = (question + "\nPrevious user questions (topics only): " + " / ".join(topics))[:2000]
    return topics, query


def safe_snapshot(answer: ChatResponse) -> dict:
    accepted = [c for c in answer.claims if c.status == "potentially_supported"]
    sources = {}
    for claim in accepted:
        for citation in claim.citations:
            sources.setdefault(citation.source_id, ChatSource.model_validate(citation.model_dump()))
    for source in answer.evidence_fallback:
        sources.setdefault(source.source_id, source)
    # Store only displayed checked quotes/excerpts, never rejected claims or raw prompts.
    return answer.model_copy(
        update={"claims": accepted, "sources": list(sources.values())}
    ).model_dump(mode="json")


def present_message(
    session: Session, item: Conversation, message: Message, verifier: CitationVerifier
) -> MessageResponse:
    result = MessageResponse(
        id=message.id,
        request_id=message.request_id,
        position=message.position,
        role=message.role,
        status=message.status,
        content=message.content,
        error_code=message.error_code,
        created_at=message.created_at,
    )
    if message.answer is None:
        return result
    try:
        if len(json.dumps(message.answer)) > 128000:
            raise ValueError("Oversized saved answer")
        answer = ChatResponse.model_validate(message.answer)
        if answer.answer != result.content or len(answer.claims) > 6:
            raise ValueError("Invalid saved answer")
        refs = [c for claim in answer.claims for c in claim.citations]
        if answer.evidence_fallback and (
            answer.claims
            or answer.status not in {"unreliable", "insufficient_evidence"}
            or any(not s.excerpt or len(s.excerpt) > 600 for s in answer.evidence_fallback)
        ):
            raise ValueError("Invalid saved evidence fallback")
        evidence = [*refs, *answer.evidence_fallback]
        fields = {
            "source_id",
            "citation_id",
            "document_id",
            "collection_id",
            "chunk_id",
            "page_number",
            "filename",
        }

        def key(source):
            return tuple(str(getattr(source, field)) for field in sorted(fields))

        if len(answer.sources) > 20 or {key(s) for s in answer.sources} != {
            key(c) for c in evidence
        }:
            raise ValueError("Invalid saved source metadata")
        if any(not claim.citations for claim in answer.claims):
            raise ValueError("Uncited saved claim")
        if (
            any(claim.status != "potentially_supported" for claim in answer.claims)
            or len(refs) > 18
        ):
            raise ValueError("Invalid saved claims")
        state = "none"
        if evidence:
            if not 0 <= answer.context_count <= 20 or any(
                c.number != int(c.citation_id.removeprefix("C"))
                or not 1 <= c.number <= answer.context_count
                for c in refs
            ):
                raise ValueError("Invalid saved citation number")
            if any(
                not re.fullmatch(r"C[1-9][0-9]?", s.citation_id)
                or not 1 <= int(s.citation_id[1:]) <= answer.context_count
                for s in evidence
            ):
                raise ValueError("Invalid saved excerpt alias")
            doc_ids = {c.document_id for c in evidence}
            found = session.scalar(
                select(func.count()).select_from(Document).where(Document.id.in_(doc_ids))
            )
            if not scope_available(session, item) or found != len(doc_ids):
                state = "unavailable"
            elif not answer.embedding_dimensions:
                state = "invalid"
            else:
                try:
                    verifier.check_sources(
                        session,
                        evidence,
                        ChatRequest(
                            question="Historical source availability",
                            collection_id=item.scope_collection_id,
                            document_id=item.scope_document_id,
                        ),
                        answer.embedding_model,
                        answer.embedding_dimensions,
                        ordered_aliases=False,
                    )
                    state = "available"
                except HTTPException:
                    state = "stale"
        result.citation_state = state
        result.answer = answer.model_copy(
            update={
                "verification": answer.verification.model_copy(
                    update={
                        "status": "not_run",
                        "notice": "Historical answer. Source availability on this load: "
                        + state
                        + ". Checks do not establish factual truth, relevance or completeness.",
                    }
                )
            }
        )
    except (ValidationError, ValueError, TypeError, KeyError):
        result.citation_state = "invalid"
    return result


def pair(
    session: Session,
    item: Conversation,
    request_id: UUID,
    verifier: CitationVerifier,
    duplicate: bool = False,
) -> TurnResponse:
    messages = session.scalars(
        select(Message)
        .where(
            Message.conversation_id == item.id,
            Message.request_id == request_id,
        )
        .order_by(Message.position)
    ).all()
    if len(messages) != 2:
        raise api_error(
            409, "turn_incomplete", "This saved turn is incomplete; refresh the conversation"
        )
    return TurnResponse(
        user=present_message(session, item, messages[0], verifier),
        assistant=present_message(session, item, messages[1], verifier),
        duplicate=duplicate,
    )


def submit_turn(
    session: Session,
    identifier: UUID,
    body: TurnRequest,
    settings: Settings,
    rag,
    embeddings,
    search,
    llm,
    verifier: CitationVerifier,
) -> TurnResponse:
    item = require_conversation(session, identifier)
    recover_expired(session, item, settings)
    previous = session.scalar(
        select(Message).where(
            Message.conversation_id == identifier,
            Message.request_id == body.request_id,
            Message.role == "user",
        )
    )
    top_k = body.top_k or settings.rag_top_k
    if previous is not None:
        if previous.content != body.question or previous.request_top_k != top_k:
            raise api_error(
                409, "request_key_reused", "This request key belongs to another question"
            )
        return pair(session, item, body.request_id, verifier, True)
    if not scope_available(session, item):
        raise api_error(
            409,
            "conversation_scope_unavailable",
            "The original conversation scope was deleted; create a new conversation",
        )
    if item.active_request_id:
        raise api_error(409, "conversation_busy", "Wait for this conversation's active question")
    position = item.next_position
    if position + 1 > settings.conversation_max_messages:
        raise api_error(409, "conversation_full", "This conversation is full; create a new one")
    topics, query = conversation_topics(session, item, body.question, settings)
    scope = ChatRequest(
        question=body.question,
        collection_id=item.scope_collection_id,
        document_id=item.scope_document_id,
        top_k=top_k,
    )
    now = utc_now()
    claimed = session.execute(
        update(Conversation)
        .where(
            Conversation.id == identifier,
            Conversation.active_request_id.is_(None),
            Conversation.next_position == position,
        )
        .values(
            active_request_id=body.request_id,
            active_started_at=now,
            next_position=position + 2,
            updated_at=now,
        )
    )
    if not claimed.rowcount:
        session.rollback()
        raise api_error(
            409, "conversation_busy", "Another request changed this conversation; refresh"
        )
    session.add_all(
        [
            Message(
                conversation_id=identifier,
                request_id=body.request_id,
                request_top_k=top_k,
                role="user",
                position=position,
                status="complete",
                content=body.question,
            ),
            Message(
                conversation_id=identifier,
                request_id=body.request_id,
                request_top_k=top_k,
                role="assistant",
                position=position + 1,
                status="pending",
                content="",
            ),
        ]
    )
    session.commit()  # Reservation + both rows are durable before the slow generation.
    failure = None
    answer = None
    try:
        answer = rag.run(
            session, embeddings, search, llm, scope, verifier, history=topics, retrieval_query=query
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        code = detail.get("code")
        allowed = {
            "chat_busy",
            "chat_unavailable",
            "chat_model_missing",
            "generation_timeout",
            "invalid_generation",
            "chat_context_too_large",
            "generation_failed",
            "embedding_unavailable",
            "search_busy",
            "evidence_changed",
        }
        failure = code if code in allowed else "generation_failed"
    except Exception:
        # Persist a safe failure, never provider bodies, prompts or SQL diagnostics.
        failure = "generation_failed"
    session.rollback()
    try:
        released = session.execute(
            update(Conversation)
            .where(
                Conversation.id == identifier,
                Conversation.active_request_id == body.request_id,
            )
            .values(active_request_id=None, active_started_at=None, updated_at=utc_now())
        )
        if not released.rowcount:
            session.rollback()
            raise api_error(409, "turn_expired", "This turn expired; refresh before retrying")
        values = {
            "status": "failed",
            "content": (
                "Generation failed. Review the scope and local services, "
                "then retry with a new request key."
            ),
            "error_code": failure,
        }
        if answer is not None and failure is None:
            values = {
                "status": "complete",
                "content": answer.answer,
                "answer": safe_snapshot(answer),
                "error_code": None,
            }
        session.execute(
            update(Message)
            .where(
                Message.conversation_id == identifier,
                Message.request_id == body.request_id,
                Message.role == "assistant",
                Message.status == "pending",
            )
            .values(**values)
        )
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        # The durable pending pair can be recovered after its bounded lease expires.
        raise api_error(
            503,
            "turn_save_failed",
            (
                "The answer could not be saved. Refresh before retrying; "
                "the request key prevents duplication."
            ),
        ) from None
    return pair(session, require_conversation(session, identifier), body.request_id, verifier)
