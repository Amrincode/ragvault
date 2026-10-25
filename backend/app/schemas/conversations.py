from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.chat import ChatRequest, ChatResponse


class ConversationName(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(default="New conversation", min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def valid_title(cls, value: str) -> str:
        return ChatRequest.visible_question(value)


class ConversationCreate(ConversationName):
    collection_id: UUID | None = None
    document_id: UUID | None = None


class ConversationResponse(BaseModel):
    id: UUID
    title: str
    collection_id: UUID | None
    document_id: UUID | None
    scope_available: bool
    scope_label: str
    generating: bool
    created_at: datetime
    updated_at: datetime


class ConversationPage(BaseModel):
    items: list[ConversationResponse]
    total: int
    limit: int
    offset: int


class TurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    question: str = Field(min_length=1, max_length=2000)
    top_k: int | None = Field(default=None, ge=1, le=20, strict=True)

    @field_validator("question")
    @classmethod
    def visible_question(cls, value: str) -> str:
        return ChatRequest.visible_question(value)


class MessageResponse(BaseModel):
    id: UUID
    request_id: UUID
    position: int
    role: Literal["user", "assistant"]
    status: Literal["pending", "complete", "failed"]
    content: str
    answer: ChatResponse | None = None
    error_code: str | None = None
    citation_state: Literal["none", "available", "stale", "unavailable", "invalid"] = "none"
    created_at: datetime


class MessagePage(BaseModel):
    items: list[MessageResponse]
    total: int
    limit: int
    offset: int


class TurnResponse(BaseModel):
    user: MessageResponse
    assistant: MessageResponse
    duplicate: bool = False
