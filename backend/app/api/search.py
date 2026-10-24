from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.schemas.library import DocumentResponse
from app.schemas.search import SearchRequest, SearchResponse
from app.services.embeddings import EmbeddingClient, get_embeddings
from app.services.indexing import DocumentIndexer, get_indexer
from app.services.library import require_document
from app.services.search import SemanticSearch, get_search

router = APIRouter(prefix="/api", tags=["semantic search"])
DB = Annotated[Session, Depends(get_session)]
Embeddings = Annotated[EmbeddingClient, Depends(get_embeddings)]


@router.post("/documents/{document_id}/index", response_model=DocumentResponse)
def index_document(
    document_id: UUID,
    session: DB,
    client: Embeddings,
    indexer: Annotated[DocumentIndexer, Depends(get_indexer)],
):
    return indexer.index(session, client, document_id)


@router.get("/documents/{document_id}/indexing", response_model=DocumentResponse)
def indexing_status(document_id: UUID, session: DB):
    return require_document(session, document_id)


@router.post("/search", response_model=SearchResponse)
def semantic_search(
    body: SearchRequest,
    session: DB,
    client: Embeddings,
    search: Annotated[SemanticSearch, Depends(get_search)],
):
    return search.run(session, client, body)
