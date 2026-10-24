"""Create the PDF document library.

Revision ID: 0001_document_library
Revises: None
"""

import sqlalchemy as sa

from alembic import op

revision = "0001_document_library"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("length(trim(name)) > 0", name=op.f("ck_collections_name_not_blank")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_collections")),
    )
    op.create_index(
        "uq_collections_name_lower", "collections", [sa.text("lower(name)")], unique=True
    )
    op.create_table(
        "documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("collection_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("storage_key", sa.String(36), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(40), nullable=False),
        sa.Column("checksum", sa.String(64), nullable=False),
        sa.Column("processing_status", sa.String(20), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("file_size > 0", name=op.f("ck_documents_file_size_positive")),
        sa.CheckConstraint("length(checksum) = 64", name=op.f("ck_documents_checksum_length")),
        sa.CheckConstraint(
            "processing_status = 'uploaded'", name=op.f("ck_documents_processing_status_allowed")
        ),
        sa.CheckConstraint(
            "mime_type = 'application/pdf'", name=op.f("ck_documents_mime_type_pdf")
        ),
        sa.ForeignKeyConstraint(
            ["collection_id"],
            ["collections.id"],
            name=op.f("fk_documents_collection_id_collections"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_documents")),
        sa.UniqueConstraint("storage_key", name=op.f("uq_documents_storage_key")),
    )
    op.create_index("ix_documents_collection_id", "documents", ["collection_id"])
    op.create_index(
        "uq_documents_collection_checksum", "documents", ["collection_id", "checksum"], unique=True
    )
    op.create_index("ix_documents_created_id", "documents", ["created_at", "id"])


def downgrade() -> None:
    op.drop_table("documents")
    op.drop_table("collections")
