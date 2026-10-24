import re
import unicodedata
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


def safe_pdf_name(value: str, *, upload: bool = False) -> str:
    value = unicodedata.normalize("NFKC", value)
    if re.search(r"%0[0ad]", value, re.IGNORECASE):
        raise ValueError("Filename contains encoded control characters")
    if upload:
        value = PurePosixPath(value.replace("\\", "/")).name
    if any(char in value for char in '/\\<>:"|?*') or any(
        unicodedata.category(char).startswith("C") for char in value
    ):
        raise ValueError("Filename contains unsafe characters")
    value = value.strip()
    if not value.lower().endswith(".pdf") or len(value) > 255 or not value[:-4].strip(" ."):
        raise ValueError("Use a filename ending in .pdf, between 5 and 255 characters")
    return value


class CollectionName(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value or any(unicodedata.category(char).startswith("C") for char in value):
            raise ValueError("Collection name must contain visible characters")
        return value


class DocumentName(BaseModel):
    filename: str = Field(min_length=5, max_length=255)

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        return safe_pdf_name(value)


class TimestampedResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def ensure_timezone(cls, value: datetime) -> datetime:
        # PostgreSQL preserves timezones; SQLite test fixtures return naive UTC values.
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class CollectionResponse(TimestampedResponse):
    id: UUID
    name: str
    document_count: int = 0


class DocumentResponse(TimestampedResponse):
    id: UUID
    collection_id: UUID
    filename: str
    file_size: int
    mime_type: Literal["application/pdf"]
    checksum: str
    processing_status: Literal["uploaded", "processing", "processed", "failed", "no_text"]
    processing_started_at: datetime | None = None
    processed_at: datetime | None = None
    processing_error: str | None = None
    page_count: int | None = None
    chunk_count: int = 0
    chunk_size_chars: int | None = None
    chunk_overlap_chars: int | None = None
    indexing_status: Literal["not_indexed", "indexing", "indexed", "failed"] = "not_indexed"
    indexing_started_at: datetime | None = None
    indexed_at: datetime | None = None
    indexing_error: str | None = None
    indexed_chunk_count: int = 0
    embedding_model: str | None = None
    embedding_digest: str | None = None
    embedding_dimensions: int | None = None

    @field_validator("processing_started_at", "processed_at", "indexing_started_at", "indexed_at")
    @classmethod
    def processing_timezone(cls, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


class ChunkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    document_id: UUID
    page_number: int
    chunk_index: int
    text: str
    start_char: int
    end_char: int
    created_at: datetime


class ChunkPage(BaseModel):
    items: list[ChunkResponse]
    total: int
    limit: int
    offset: int


class DocumentPage(BaseModel):
    items: list[DocumentResponse]
    total: int
    limit: int
    offset: int
