from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=2000)
    collection_id: UUID | None = None
    document_id: UUID | None = None
    top_k: int | None = Field(default=None, ge=1, le=20, strict=True)

    @field_validator("question")
    @classmethod
    def visible_question(cls, value: str) -> str:
        value = value.strip()
        value.encode("utf-8")  # Reject invalid Unicode before context byte budgeting.
        if not value or any(ord(c) < 32 and c not in "\n\t\r" for c in value):
            raise ValueError("Enter a question without control characters")
        return value


class ChatSource(BaseModel):
    source_id: str
    document_id: UUID
    filename: str
    collection_id: UUID
    page_number: int
    chunk_id: UUID
    excerpt: str


class ChatTimings(BaseModel):
    retrieval_ms: float
    generation_ms: float
    total_ms: float


class ChatResponse(BaseModel):
    status: Literal["answered", "insufficient_evidence"]
    answer: str
    sources: list[ChatSource]
    chat_model: str
    embedding_model: str
    retrieval_count: int
    context_count: int
    incompatible_documents: int = 0
    timings: ChatTimings
