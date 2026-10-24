"""Index existing chunks; claim early, perform network work outside transactions."""

from datetime import timedelta
from threading import BoundedSemaphore
from time import monotonic
from uuid import UUID, uuid4

from fastapi import Request
from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import api_error
from app.models import ChunkEmbedding, Document, DocumentChunk
from app.models.library import utc_now
from app.services.embeddings import EmbeddingClient, EmbeddingFailure
from app.services.library import require_document

INDEX_ERROR = "Indexing failed: check Ollama, embedding model and resource limits, then retry."


class DocumentIndexer:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.slot = BoundedSemaphore(1)

    def index(self, session: Session, client: EmbeddingClient, identifier: UUID) -> Document:
        document = require_document(session, identifier)
        if document.processing_status != "processed" or not document.chunk_count:
            raise api_error(
                409, "document_not_processed", "Process a PDF with extractable text before indexing"
            )
        if not self.slot.acquire(blocking=False):
            raise api_error(409, "indexer_busy", "Another document is indexing; try again shortly")
        token = uuid4()
        claimed = False
        deadline = monotonic() + self.settings.indexing_timeout_seconds
        try:
            now = utc_now()
            cutoff = now - timedelta(seconds=self.settings.indexing_timeout_seconds + 60)
            result = session.execute(
                update(Document)
                .execution_options(synchronize_session=False)
                .where(
                    Document.id == identifier,
                    Document.processing_status == "processed",
                    or_(
                        Document.indexing_status != "indexing",
                        Document.indexing_started_at < cutoff,
                        Document.indexing_started_at.is_(None),
                    ),
                )
                .values(
                    indexing_status="indexing",
                    indexing_token=token,
                    indexing_started_at=now,
                    indexing_error=None,
                    indexed_at=None,
                    indexed_chunk_count=0,
                    embedding_model=None,
                    embedding_digest=None,
                    embedding_dimensions=None,
                    embedding_fingerprint=None,
                )
            )
            if result.rowcount != 1:
                session.rollback()
                raise api_error(
                    409,
                    "document_indexing",
                    "Document is already indexing or is no longer processed",
                )
            chunk_ids = select(DocumentChunk.id).where(DocumentChunk.document_id == identifier)
            session.execute(delete(ChunkEmbedding).where(ChunkEmbedding.chunk_id.in_(chunk_ids)))
            session.commit()
            claimed = True
            rows = session.execute(
                select(DocumentChunk.id, DocumentChunk.text)
                .where(DocumentChunk.document_id == identifier)
                .order_by(DocumentChunk.chunk_index)
                .limit(self.settings.max_index_chunks + 1)
            ).all()
            source = [(row.id, row.text) for row in rows]
            session.rollback()
            if not source or len(source) > self.settings.max_index_chunks:
                raise EmbeddingFailure
            identity = client.identity(deadline=deadline)
            vectors = []
            dimensions = None
            for start in range(0, len(source), self.settings.embedding_batch_size):
                batch = source[start : start + self.settings.embedding_batch_size]
                encoded = client.embed(
                    [text for _, text in batch], identity, dimensions=dimensions, deadline=deadline
                )
                dimensions = len(encoded[0])
                if len(source) * dimensions > self.settings.max_index_vector_values:
                    raise EmbeddingFailure
                vectors.extend(encoded)
            if monotonic() > deadline or client.identity(deadline=deadline) != identity:
                raise EmbeddingFailure
            fingerprint = client.fingerprint(identity, dimensions)
            document = require_document(session, identifier, lock=True)
            if document.indexing_token != token or document.processing_status != "processed":
                raise api_error(
                    409,
                    "indexing_replaced",
                    "Source processing or a newer indexing attempt replaced this attempt",
                )
            current_ids = list(
                session.scalars(
                    select(DocumentChunk.id)
                    .where(DocumentChunk.document_id == identifier)
                    .order_by(DocumentChunk.chunk_index)
                )
            )
            if current_ids != [identifier for identifier, _ in source]:
                raise EmbeddingFailure
            session.add_all(
                [
                    ChunkEmbedding(
                        chunk_id=source[i][0],
                        vector=vector,
                        dimensions=dimensions,
                        fingerprint=fingerprint,
                    )
                    for i, vector in enumerate(vectors)
                ]
            )
            document.indexing_status = "indexed"
            document.indexing_token = None
            document.indexing_error = None
            document.indexed_at = utc_now()
            document.indexed_chunk_count = len(source)
            document.embedding_model = identity.name
            document.embedding_digest = identity.digest
            document.embedding_dimensions = dimensions
            document.embedding_fingerprint = fingerprint
            session.commit()
            return document
        except (EmbeddingFailure, SQLAlchemyError):
            session.rollback()
            if claimed:
                session.execute(
                    update(Document)
                    .where(Document.id == identifier, Document.indexing_token == token)
                    .values(
                        indexing_status="failed",
                        indexing_token=None,
                        indexing_error=INDEX_ERROR,
                        indexed_chunk_count=0,
                    )
                )
                session.commit()
            raise api_error(503, "indexing_failed", INDEX_ERROR) from None
        finally:
            self.slot.release()


def get_indexer(request: Request) -> DocumentIndexer:
    return request.app.state.indexer
