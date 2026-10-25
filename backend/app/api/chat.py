from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.citations import CitationVerifier, get_citation_verifier
from app.services.embeddings import EmbeddingClient, get_embeddings
from app.services.llm import LLMClient, get_llm
from app.services.rag import RAGEngine, get_rag
from app.services.search import SemanticSearch, get_search

router = APIRouter(prefix="/api", tags=["document chat"])


@router.post("/chat", response_model=ChatResponse)
def document_chat(
    body: ChatRequest,
    response: Response,
    session: Annotated[Session, Depends(get_session)],
    embeddings: Annotated[EmbeddingClient, Depends(get_embeddings)],
    search: Annotated[SemanticSearch, Depends(get_search)],
    llm: Annotated[LLMClient, Depends(get_llm)],
    rag: Annotated[RAGEngine, Depends(get_rag)],
    verifier: Annotated[CitationVerifier, Depends(get_citation_verifier)],
):
    response.headers["Cache-Control"] = "no-store"
    return rag.run(session, embeddings, search, llm, body, verifier)
