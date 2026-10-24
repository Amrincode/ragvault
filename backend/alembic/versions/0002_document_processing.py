"""Store page-aware text chunks and processing lifecycle metadata."""

import sqlalchemy as sa

from alembic import op

revision = "0002_document_processing"
down_revision = "0001_document_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_documents_processing_status_allowed"), "documents", type_="check")
    op.create_check_constraint(
        op.f("ck_documents_processing_status_allowed"),
        "documents",
        "processing_status IN ('uploaded','processing','processed','failed','no_text')",
    )
    for column in (
        sa.Column("processing_token", sa.Uuid(), nullable=True),
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processing_error", sa.String(240), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("chunk_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("chunk_size_chars", sa.Integer(), nullable=True),
        sa.Column("chunk_overlap_chars", sa.Integer(), nullable=True),
    ):
        op.add_column("documents", column)
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("start_char", sa.Integer(), nullable=False),
        sa.Column("end_char", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("document_id", "chunk_index"),
        sa.CheckConstraint("page_number >= 1", name=op.f("ck_document_chunks_page_positive")),
        sa.CheckConstraint("chunk_index >= 0", name=op.f("ck_document_chunks_index_nonnegative")),
        sa.CheckConstraint(
            "length(trim(text)) > 0", name=op.f("ck_document_chunks_text_not_blank")
        ),
        sa.CheckConstraint(
            "start_char >= 0 AND end_char > start_char",
            name=op.f("ck_document_chunks_offsets_valid"),
        ),
    )
    op.create_index(
        "ix_document_chunks_document_page", "document_chunks", ["document_id", "page_number"]
    )


def downgrade() -> None:
    # Downgrade deliberately requires an explicit operation; never called by startup.
    op.drop_table("document_chunks")
    for name in (
        "processing_token",
        "processing_started_at",
        "processed_at",
        "processing_error",
        "page_count",
        "chunk_count",
        "chunk_size_chars",
        "chunk_overlap_chars",
    ):
        op.drop_column("documents", name)
    op.execute("UPDATE documents SET processing_status = 'uploaded'")
    op.drop_constraint(op.f("ck_documents_processing_status_allowed"), "documents", type_="check")
    op.create_check_constraint(
        op.f("ck_documents_processing_status_allowed"),
        "documents",
        "processing_status = 'uploaded'",
    )
