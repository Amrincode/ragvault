from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int | None = Field(default=None, ge=1, le=20)
    collection_id: UUID | None = None
    document_id: UUID | None = None

    @field_validator("query")
    @classmethod
    def visible_query(cls, value: str) -> str:
        value = value.strip()
        if not value or "\x00" in value:
            raise ValueError("Enter a nonempty search question without NUL characters")
        return value


class SearchHit(BaseModel):
    document_id: UUID
    filename: str
    collection_id: UUID
    page_number: int
    chunk_id: UUID
    excerpt: str
    distance: float
    similarity: float


class SearchResponse(BaseModel):
    items: list[SearchHit]
    model: str
    dimensions: int
    top_k: int
    elapsed_ms: float
    incompatible_documents: int = 0
