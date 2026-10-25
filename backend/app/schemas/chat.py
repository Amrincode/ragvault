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
    citation_id: str = ""
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
    verification_ms: float = 0


class CheckedCitation(ChatSource):
    number: int
    match_method: Literal["exact", "whitespace_normalized"]


class AnswerClaim(BaseModel):
    text: str
    status: Literal[
        "potentially_supported",
        "uncited",
        "invalid_citation",
        "support_not_established",
        "relevance_not_established",
        "potential_conflict",
    ]
    citations: list[CheckedCitation] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)


class CitationVerification(BaseModel):
    status: Literal["not_run", "source_checks_passed", "issues_found"] = "not_run"
    factual_support: Literal["not_established"] = "not_established"
    accepted_claims: int = 0
    withheld_claims: int = 0
    notice: str = (
        "Source and wording checks do not independently establish factual truth, "
        "relevance, completeness or absence of contradictions. Review the original pages."
    )


class ChatResponse(BaseModel):
    status: Literal["answered", "partial", "insufficient_evidence", "unreliable"]
    answer: str
    sources: list[ChatSource]
    chat_model: str
    embedding_model: str
    embedding_dimensions: int | None = None
    retrieval_count: int
    context_count: int
    incompatible_documents: int = 0
    timings: ChatTimings
    claims: list[AnswerClaim] = Field(default_factory=list)
    verification: CitationVerification = Field(default_factory=CitationVerification)
    evidence_fallback: list[ChatSource] = Field(default_factory=list, max_length=2)
