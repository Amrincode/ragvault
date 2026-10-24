from datetime import UTC, datetime
from uuid import UUID, uuid4

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class Collection(Base):
    __tablename__ = "collections"
    __table_args__ = (CheckConstraint("length(trim(name)) > 0", name="name_not_blank"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, server_default=func.now()
    )
    documents: Mapped[list["Document"]] = relationship(
        back_populates="collection", passive_deletes="all"
    )


Index("uq_collections_name_lower", func.lower(Collection.name), unique=True)


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("file_size > 0", name="file_size_positive"),
        CheckConstraint("length(checksum) = 64", name="checksum_length"),
        CheckConstraint(
            "processing_status IN ('uploaded','processing','processed','failed','no_text')",
            name="processing_status_allowed",
        ),
        CheckConstraint("mime_type = 'application/pdf'", name="mime_type_pdf"),
        CheckConstraint(
            "indexing_status IN ('not_indexed','indexing','indexed','failed')",
            name="indexing_status_allowed",
        ),
        Index("uq_documents_collection_checksum", "collection_id", "checksum", unique=True),
        Index("ix_documents_created_id", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    collection_id: Mapped[UUID] = mapped_column(
        ForeignKey("collections.id", ondelete="RESTRICT"), index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(40), default="application/pdf", nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    processing_status: Mapped[str] = mapped_column(String(20), default="uploaded", nullable=False)
    processing_token: Mapped[UUID | None] = mapped_column()
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processing_error: Mapped[str | None] = mapped_column(String(240))
    page_count: Mapped[int | None] = mapped_column(Integer)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    chunk_size_chars: Mapped[int | None] = mapped_column(Integer)
    chunk_overlap_chars: Mapped[int | None] = mapped_column(Integer)
    indexing_status: Mapped[str] = mapped_column(
        String(20), default="not_indexed", server_default="not_indexed"
    )
    indexing_token: Mapped[UUID | None] = mapped_column()
    indexing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    indexing_error: Mapped[str | None] = mapped_column(String(240))
    indexed_chunk_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    embedding_model: Mapped[str | None] = mapped_column(String(200))
    embedding_digest: Mapped[str | None] = mapped_column(String(128))
    embedding_dimensions: Mapped[int | None] = mapped_column(Integer)
    embedding_fingerprint: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, server_default=func.now()
    )
    collection: Mapped[Collection] = relationship(back_populates="documents")
    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="document", passive_deletes="all"
    )


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index"),
        CheckConstraint("page_number >= 1", name="page_positive"),
        CheckConstraint("chunk_index >= 0", name="index_nonnegative"),
        CheckConstraint("length(trim(text)) > 0", name="text_not_blank"),
        CheckConstraint("start_char >= 0 AND end_char > start_char", name="offsets_valid"),
        Index("ix_document_chunks_document_page", "document_id", "page_number"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    page_number: Mapped[int] = mapped_column(Integer)
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    start_char: Mapped[int] = mapped_column(Integer)
    end_char: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
    document: Mapped[Document] = relationship(back_populates="chunks")
    embedding: Mapped["ChunkEmbedding | None"] = relationship(
        back_populates="chunk", passive_deletes="all", uselist=False
    )


class ChunkEmbedding(Base):
    __tablename__ = "chunk_embeddings"
    __table_args__ = (
        CheckConstraint("dimensions > 0 AND dimensions <= 16000", name="dimensions_valid"),
        Index("ix_chunk_embeddings_fingerprint", "fingerprint", "dimensions"),
    )
    chunk_id: Mapped[UUID] = mapped_column(
        ForeignKey("document_chunks.id", ondelete="CASCADE"), primary_key=True
    )
    # Dimensionless storage supports independently verified alternative model sizes.
    # JSON is used only for isolated SQLite unit-test persistence, never for production search.
    vector: Mapped[list[float]] = mapped_column(VECTOR().with_variant(JSON, "sqlite"))
    dimensions: Mapped[int] = mapped_column(Integer)
    fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
    chunk: Mapped[DocumentChunk] = relationship(back_populates="embedding")
