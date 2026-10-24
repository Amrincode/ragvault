"""Add pgvector storage and an independent document indexing lifecycle."""

import sqlalchemy as sa
from pgvector.sqlalchemy import VECTOR

from alembic import op

revision = "0003_semantic_search"
down_revision = "0002_document_processing"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    for column in (
        sa.Column("indexing_status", sa.String(20), server_default="not_indexed", nullable=False),
        sa.Column("indexing_token", sa.Uuid(), nullable=True),
        sa.Column("indexing_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("indexing_error", sa.String(240), nullable=True),
        sa.Column("indexed_chunk_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("embedding_model", sa.String(200), nullable=True),
        sa.Column("embedding_digest", sa.String(128), nullable=True),
        sa.Column("embedding_dimensions", sa.Integer(), nullable=True),
        sa.Column("embedding_fingerprint", sa.String(64), nullable=True),
    ):
        op.add_column("documents", column)
    op.create_check_constraint(
        op.f("ck_documents_indexing_status_allowed"),
        "documents",
        "indexing_status IN ('not_indexed','indexing','indexed','failed')",
    )
    op.create_table(
        "chunk_embeddings",
        sa.Column(
            "chunk_id",
            sa.Uuid(),
            sa.ForeignKey("document_chunks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("vector", VECTOR(), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "dimensions > 0 AND dimensions <= 16000",
            name=op.f("ck_chunk_embeddings_dimensions_valid"),
        ),
    )
    op.create_index(
        "ix_chunk_embeddings_fingerprint", "chunk_embeddings", ["fingerprint", "dimensions"]
    )


def downgrade():
    op.drop_table("chunk_embeddings")
    op.drop_constraint(op.f("ck_documents_indexing_status_allowed"), "documents", type_="check")
    for column in (
        "indexing_status",
        "indexing_token",
        "indexing_started_at",
        "indexed_at",
        "indexing_error",
        "indexed_chunk_count",
        "embedding_model",
        "embedding_digest",
        "embedding_dimensions",
        "embedding_fingerprint",
    ):
        op.drop_column("documents", column)
    # Do not remove the shared vector extension or affect other schemas using it.
