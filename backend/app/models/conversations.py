from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
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
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.library import utc_now


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint("length(trim(title)) > 0 AND length(title) <= 120", name="title_valid"),
        CheckConstraint("next_position >= 1", name="position_positive"),
        Index("ix_conversations_updated_id", "updated_at", "id"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    title: Mapped[str] = mapped_column(String(120))
    collection_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("collections.id", ondelete="SET NULL"), index=True
    )
    document_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), index=True
    )
    # Immutable scope survives FK SET NULL; a missing target must never widen retrieval.
    scope_collection_id: Mapped[UUID | None] = mapped_column()
    scope_document_id: Mapped[UUID | None] = mapped_column()
    next_position: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    active_request_id: Mapped[UUID | None] = mapped_column()
    active_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "position", name="uq_messages_conversation_position"),
        UniqueConstraint("conversation_id", "request_id", "role", name="uq_messages_request_role"),
        CheckConstraint("role IN ('user','assistant')", name="role_allowed"),
        CheckConstraint("status IN ('pending','complete','failed')", name="status_allowed"),
        CheckConstraint("position >= 1", name="position_positive"),
        CheckConstraint("length(content) <= 12000", name="content_bounded"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    conversation_id: Mapped[UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    request_id: Mapped[UUID] = mapped_column()
    request_top_k: Mapped[int] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(12))
    status: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text, default="", server_default="")
    answer: Mapped[dict | None] = mapped_column(JSON)
    error_code: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
