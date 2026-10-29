"""Exact pgvector ranking with mandatory source/model filters before returning hits."""

from threading import BoundedSemaphore
from time import monotonic

from fastapi import Request
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import api_error
from app.core.logging import operation_timing
from app.models import ChunkEmbedding, Document, DocumentChunk
from app.schemas.search import SearchHit, SearchRequest, SearchResponse
from app.services.embeddings import EmbeddingClient, EmbeddingFailure
from app.services.library import require_collection, require_document


def search_statement(vector, fingerprint, body, top_k):
    compatible = ChunkEmbedding.dimensions == len(vector)
    distance = case((compatible, ChunkEmbedding.vector.cosine_distance(vector))).label("distance")
    statement = (
        select(
            Document.id.label("document_id"),
            Document.filename,
            Document.collection_id,
            DocumentChunk.page_number,
            DocumentChunk.id.label("chunk_id"),
            DocumentChunk.text.label("excerpt"),
            distance,
        )
        .join(DocumentChunk, DocumentChunk.document_id == Document.id)
        .join(ChunkEmbedding, ChunkEmbedding.chunk_id == DocumentChunk.id)
        .where(
            Document.processing_status == "processed",
            Document.indexing_status == "indexed",
            Document.embedding_fingerprint == fingerprint,
            ChunkEmbedding.fingerprint == fingerprint,
            Document.embedding_dimensions == len(vector),
            compatible,
        )
    )
    if body.collection_id is not None:
        statement = statement.where(Document.collection_id == body.collection_id)
    if body.document_id is not None:
        statement = statement.where(Document.id == body.document_id)
    return statement.order_by(distance, Document.id, DocumentChunk.chunk_index).limit(top_k)


class SemanticSearch:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.slot = BoundedSemaphore(2)

    def run(self, session: Session, client: EmbeddingClient, body: SearchRequest) -> SearchResponse:
        if body.collection_id:
            require_collection(session, body.collection_id)
        if body.document_id:
            document = require_document(session, body.document_id)
            if body.collection_id and document.collection_id != body.collection_id:
                raise api_error(
                    422,
                    "filter_mismatch",
                    "Selected document does not belong to the selected collection",
                )
        session.rollback()
        if not self.slot.acquire(blocking=False):
            raise api_error(
                409, "search_busy", "Too many searches are in progress; try again shortly"
            )
        started, completed = monotonic(), False
        deadline = started + self.settings.embedding_timeout_seconds
        try:
            identity = client.identity(deadline=deadline)
            vector = client.embed([body.query], identity, query=True, deadline=deadline)[0]
            if client.identity(deadline=deadline) != identity:
                raise EmbeddingFailure
            fingerprint = client.fingerprint(identity, len(vector))
            top_k = body.top_k or self.settings.search_top_k
            incompatible = select(func.count(Document.id)).where(
                Document.processing_status == "processed",
                Document.indexing_status == "indexed",
                or_(
                    Document.embedding_fingerprint != fingerprint,
                    Document.embedding_dimensions != len(vector),
                ),
            )
            if body.collection_id:
                incompatible = incompatible.where(Document.collection_id == body.collection_id)
            if body.document_id:
                incompatible = incompatible.where(Document.id == body.document_id)
            incompatible_count = session.scalar(incompatible) or 0
            rows = session.execute(search_statement(vector, fingerprint, body, top_k)).mappings()
            hits = []
            for row in rows:
                values = dict(row)
                distance = max(0.0, min(2.0, float(values["distance"])))
                values.update(distance=distance, similarity=1.0 - distance)
                hits.append(SearchHit(**values))
            response = SearchResponse(
                items=hits,
                model=identity.name,
                dimensions=len(vector),
                top_k=top_k,
                elapsed_ms=round((monotonic() - started) * 1000, 2),
                incompatible_documents=incompatible_count,
            )
            completed = True
            return response
        except EmbeddingFailure:
            raise api_error(
                503,
                "embedding_unavailable",
                "Embedding service or model is unavailable/incompatible. Check Ollama and retry.",
            ) from None
        finally:
            self.slot.release()
            operation_timing("search", started, completed=completed)


def get_search(request: Request) -> SemanticSearch:
    return request.app.state.semantic_search
