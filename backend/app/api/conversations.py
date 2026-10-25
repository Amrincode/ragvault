from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.session import get_session
from app.models import Conversation, Message
from app.schemas.conversations import (
    ConversationCreate,
    ConversationName,
    ConversationPage,
    ConversationResponse,
    MessagePage,
    TurnRequest,
    TurnResponse,
)
from app.services.citations import CitationVerifier, get_citation_verifier
from app.services.conversations import (
    describe,
    present_message,
    recover_expired,
    remove,
    rename,
    require_conversation,
    submit_turn,
)
from app.services.embeddings import EmbeddingClient, get_embeddings
from app.services.library import require_collection, require_document
from app.services.llm import LLMClient, get_llm
from app.services.rag import RAGEngine, get_rag
from app.services.search import SemanticSearch, get_search


def no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(
    prefix="/api/conversations", tags=["conversations"], dependencies=[Depends(no_store)]
)
DB = Annotated[Session, Depends(get_session)]
Verifier = Annotated[CitationVerifier, Depends(get_citation_verifier)]


@router.post("", response_model=ConversationResponse, status_code=201)
def create_conversation(body: ConversationCreate, session: DB):
    if body.collection_id:
        require_collection(session, body.collection_id)
    if body.document_id:
        doc = require_document(session, body.document_id)
        if body.collection_id and doc.collection_id != body.collection_id:
            raise api_error(
                422, "filter_mismatch", "The document does not belong to the collection"
            )
    item = Conversation(
        title=body.title,
        collection_id=body.collection_id,
        document_id=body.document_id,
        scope_collection_id=body.collection_id,
        scope_document_id=body.document_id,
    )
    session.add(item)
    session.commit()
    return describe(session, item)


@router.get("", response_model=ConversationPage)
def list_conversations(
    session: DB,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    items = session.scalars(
        select(Conversation)
        .order_by(Conversation.updated_at.desc(), Conversation.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return ConversationPage(
        items=[describe(session, c) for c in items],
        total=session.scalar(select(func.count()).select_from(Conversation)) or 0,
        limit=limit,
        offset=offset,
    )


@router.get("/{identifier}", response_model=ConversationResponse)
def get_conversation(identifier: UUID, request: Request, session: DB):
    item = require_conversation(session, identifier)
    recover_expired(session, item, request.app.state.settings)
    return describe(session, item)


@router.patch("/{identifier}", response_model=ConversationResponse)
def rename_conversation(identifier: UUID, body: ConversationName, request: Request, session: DB):
    item = require_conversation(session, identifier)
    recover_expired(session, item, request.app.state.settings)
    rename(session, item, body.title)
    return describe(session, require_conversation(session, identifier))


@router.delete("/{identifier}", status_code=204)
def delete_conversation(identifier: UUID, request: Request, session: DB):
    item = require_conversation(session, identifier)
    recover_expired(session, item, request.app.state.settings)
    remove(session, item)


@router.get("/{identifier}/messages", response_model=MessagePage)
def list_messages(
    identifier: UUID,
    request: Request,
    session: DB,
    verifier: Verifier,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    item = require_conversation(session, identifier)
    recover_expired(session, item, request.app.state.settings)
    condition = Message.conversation_id == identifier
    rows = session.scalars(
        select(Message)
        .where(condition)
        .order_by(Message.position.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    total = session.scalar(select(func.count()).select_from(Message).where(condition)) or 0
    return MessagePage(
        items=[present_message(session, item, row, verifier) for row in reversed(rows)],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/{identifier}/messages", response_model=TurnResponse)
def ask_conversation(
    identifier: UUID,
    body: TurnRequest,
    request: Request,
    session: DB,
    embeddings: Annotated[EmbeddingClient, Depends(get_embeddings)],
    search: Annotated[SemanticSearch, Depends(get_search)],
    llm: Annotated[LLMClient, Depends(get_llm)],
    rag: Annotated[RAGEngine, Depends(get_rag)],
    verifier: Verifier,
):
    return submit_turn(
        session,
        identifier,
        body,
        request.app.state.settings,
        rag,
        embeddings,
        search,
        llm,
        verifier,
    )
