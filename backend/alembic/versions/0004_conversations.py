"""Add durable scoped conversations and ordered messages; preserve existing library tables."""

import sqlalchemy as sa

from alembic import op

revision = "0004_conversations"
down_revision = "0003_semantic_search"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "conversations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("collection_id", sa.Uuid(), sa.ForeignKey("collections.id", ondelete="SET NULL")),
        sa.Column("document_id", sa.Uuid(), sa.ForeignKey("documents.id", ondelete="SET NULL")),
        sa.Column("scope_collection_id", sa.Uuid()),
        sa.Column("scope_document_id", sa.Uuid()),
        sa.Column("next_position", sa.Integer(), server_default="1", nullable=False),
        sa.Column("active_request_id", sa.Uuid()),
        sa.Column("active_started_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "length(trim(title)) > 0 AND length(title) <= 120",
            name=op.f("ck_conversations_title_valid"),
        ),
        sa.CheckConstraint("next_position >= 1", name=op.f("ck_conversations_position_positive")),
    )
    op.create_index("ix_conversations_collection_id", "conversations", ["collection_id"])
    op.create_index("ix_conversations_document_id", "conversations", ["document_id"])
    op.create_index("ix_conversations_updated_id", "conversations", ["updated_at", "id"])
    op.create_table(
        "messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Uuid(),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("request_top_k", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(12), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("answer", sa.JSON()),
        sa.Column("error_code", sa.String(60)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "conversation_id", "position", name="uq_messages_conversation_position"
        ),
        sa.UniqueConstraint(
            "conversation_id", "request_id", "role", name="uq_messages_request_role"
        ),
        sa.CheckConstraint("role IN ('user','assistant')", name=op.f("ck_messages_role_allowed")),
        sa.CheckConstraint(
            "status IN ('pending','complete','failed')", name=op.f("ck_messages_status_allowed")
        ),
        sa.CheckConstraint("position >= 1", name=op.f("ck_messages_position_positive")),
        sa.CheckConstraint("length(content) <= 12000", name=op.f("ck_messages_content_bounded")),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])


def downgrade():
    # Explicit downgrade deletes conversation history; never run against user data casually.
    op.drop_table("messages")
    op.drop_table("conversations")
