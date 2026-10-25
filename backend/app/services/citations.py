"""Source integrity is deterministic; wording overlap is not semantic entailment."""

import re
from dataclasses import dataclass
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import ChunkEmbedding, Document, DocumentChunk
from app.schemas.chat import AnswerClaim, ChatRequest, ChatSource, CheckedCitation
from app.services.embeddings import canonical_model
from app.services.evidence_focus import (
    category_labels,
    category_quote_matches,
    page_limit_question,
    question_scope_issue,
    report_contents_question,
    requested_category,
)
from app.services.llm import GeneratedAnswer


@dataclass(frozen=True)
class SourceRecord:
    document_id: UUID
    filename: str
    collection_id: UUID
    page_number: int
    chunk_id: UUID
    text: str
    model: str | None
    dimensions: int | None
    eligible: bool


def load_records(session: Session, sources: list[ChatSource]) -> dict[UUID, SourceRecord]:
    statement = (
        select(DocumentChunk, Document, ChunkEmbedding)
        .select_from(DocumentChunk)
        .join(Document, Document.id == DocumentChunk.document_id)
        .join(ChunkEmbedding, ChunkEmbedding.chunk_id == DocumentChunk.id)
        .where(DocumentChunk.id.in_([s.chunk_id for s in sources]))
    )
    return {
        chunk.id: SourceRecord(
            document.id,
            document.filename,
            document.collection_id,
            chunk.page_number,
            chunk.id,
            chunk.text,
            document.embedding_model,
            document.embedding_dimensions,
            document.processing_status == "processed"
            and document.indexing_status == "indexed"
            and bool(document.embedding_fingerprint)
            and document.embedding_fingerprint == vector.fingerprint
            and document.embedding_dimensions == vector.dimensions,
        )
        for chunk, document, vector in session.execute(statement).all()
    }


def normalized(text: str) -> str:
    return " ".join(text.split()).casefold()


def wording_match(claim: str, quote: str) -> bool:
    # A display sentence may add one final period to a verbatim list item/quote.
    # Do not remove words, parentheses, negation, digits or interior punctuation.
    value = normalized(claim).removesuffix(".")
    return bool(value and re.search(r"(?<!\w)" + re.escape(value) + r"(?!\w)", normalized(quote)))


def match_quote(quote: str, text: str) -> tuple[str, str] | None:
    if not quote.strip():
        return None
    if quote in text:
        return quote, "exact"
    # Formatting-only tolerance; return the original matched characters, never invented text.
    pattern = r"\s+".join(re.escape(part) for part in quote.strip().split())
    match = re.search(pattern, text)
    return (match.group(), "whitespace_normalized") if match else None


NUMBER = re.compile(
    r"\b(?:\d+(?:[.,]\d+)*|zero|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|"
    r"twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b",
    re.IGNORECASE,
)


def numeric_conflict(text: str, sources: list[ChatSource]) -> bool:
    """Heuristic: same surrounding words with different numeric tokens, not contradiction proof."""
    claim = normalized(text)
    numbers = list(NUMBER.finditer(claim))
    if not numbers:
        return False
    pieces, offset = [], 0
    for number in numbers:
        pieces.extend([re.escape(claim[offset : number.start()]), f"({NUMBER.pattern})"])
        offset = number.end()
    pieces.append(re.escape(claim[offset:]))
    pattern = re.compile(r"(?<!\w)" + "".join(pieces) + r"(?!\w)", re.IGNORECASE)
    expected = tuple(n.group().casefold() for n in numbers)
    return any(
        tuple(group.casefold() for group in match.groups()) != expected
        for source in sources
        for match in pattern.finditer(normalized(source.excerpt))
    )


def category_omitted(claim: str, citation: CheckedCitation, source: ChatSource) -> bool:
    # Keep category qualifiers that precede the quote in the SAME source sentence.
    # A label elsewhere in a paragraph is not assumed to qualify all later facts.
    prefix = source.excerpt[: source.excerpt.index(citation.excerpt)]
    clause = re.split(r"[.!?](?:\s|$)", prefix)[-1] + citation.excerpt
    labels = category_labels(clause)
    return bool(labels) and not any(
        re.search(r"\b" + re.escape(label) + r"\b", claim, re.IGNORECASE) for label in labels
    )


def verify_claims(
    generated: GeneratedAnswer, sources: list[ChatSource], question: str = ""
) -> list[AnswerClaim]:
    """Accept only claim wording witnessed in supplied, source-checked quotations."""
    allowed = {source.citation_id: source for source in sources}
    results = []
    for claim in generated.claims:
        if not claim.citations:
            results.append(
                AnswerClaim(text=claim.text, status="uncited", issues=["missing_citation"])
            )
            continue
        citations, issues, seen = [], [], set()
        for reference in claim.citations:
            source = allowed.get(reference.citation_id)
            key = (reference.citation_id, reference.quote)
            if source is None:
                issues.append("unknown_citation")
                continue
            if key in seen:
                issues.append("duplicate_citation")
                continue
            seen.add(key)
            matched = match_quote(reference.quote, source.excerpt)
            if matched is None:
                issues.append("missing_quote" if not reference.quote.strip() else "quote_mismatch")
                continue
            excerpt, method = matched
            citations.append(
                CheckedCitation(
                    **source.model_dump(exclude={"excerpt"}),
                    excerpt=excerpt,
                    number=int(source.citation_id[1:]),
                    match_method=method,
                )
            )
        if issues:
            results.append(
                AnswerClaim(
                    text=claim.text,
                    status="invalid_citation",
                    issues=sorted(set(issues)),
                )
            )
        elif not all(wording_match(claim.text, c.excerpt) for c in citations):
            reason = (
                "numeric_support_not_established"
                if NUMBER.search(claim.text)
                else "wording_not_matched"
            )
            results.append(
                AnswerClaim(
                    text=claim.text,
                    status="support_not_established",
                    citations=citations,
                    issues=[reason],
                )
            )
        elif numeric_conflict(claim.text, sources):
            results.append(
                AnswerClaim(
                    text=claim.text,
                    status="potential_conflict",
                    citations=citations,
                    issues=["heuristic_numeric_conflict"],
                )
            )
        elif NUMBER.search(claim.text) and any(
            category_omitted(claim.text, c, allowed[c.citation_id]) for c in citations
        ):
            results.append(
                AnswerClaim(
                    text=claim.text,
                    status="support_not_established",
                    citations=citations,
                    issues=["numeric_category_omitted"],
                )
            )
        elif (
            issue := question_scope_issue(
                question, claim.text, [source.excerpt for source in sources]
            )
        ) and not (
            issue == "requested_category_not_matched"
            and report_contents_question(question)
            and not page_limit_question(question)
            and not NUMBER.search(claim.text)
            and (label := requested_category(question))
            and not (category_labels(claim.text) - {label})
            and all(
                category_quote_matches(label, c.excerpt, allowed[c.citation_id].excerpt)
                for c in citations
            )
        ):
            results.append(
                AnswerClaim(
                    text=claim.text,
                    status="relevance_not_established",
                    citations=citations,
                    issues=[issue],
                )
            )
        elif (
            (label := requested_category(question))
            and report_contents_question(question)
            and not all(
                category_quote_matches(
                    label, c.excerpt, allowed[c.citation_id].excerpt, report=True
                )
                for c in citations
            )
        ):
            results.append(
                AnswerClaim(
                    text=claim.text,
                    status="relevance_not_established",
                    citations=citations,
                    issues=["requested_report_section_not_matched"],
                )
            )
        else:
            results.append(
                AnswerClaim(
                    text=claim.text,
                    status="potentially_supported",
                    citations=citations,
                )
            )
    return results


class CitationVerifier:
    def __init__(self, loader=load_records):
        self.loader = loader

    def check_sources(
        self,
        session: Session,
        sources: list[ChatSource],
        body: ChatRequest,
        model: str,
        dimensions: int,
        *,
        ordered_aliases: bool = True,
    ) -> None:
        records = self.loader(session, sources)
        expected = len(sources) if ordered_aliases else len({s.chunk_id for s in sources})
        valid = len(records) == expected
        for index, source in enumerate(sources, 1):
            record = records.get(source.chunk_id)
            valid = valid and bool(
                record
                and record.eligible
                and record.model
                and canonical_model(record.model) == canonical_model(model)
                and record.dimensions == dimensions
                and source.source_id == "S-" + str(source.chunk_id)
                and (
                    source.citation_id == f"C{index}"
                    if ordered_aliases
                    else bool(re.fullmatch(r"C[1-9][0-9]?", source.citation_id))
                )
                and source.document_id == record.document_id
                and source.chunk_id == record.chunk_id
                and source.filename == record.filename
                and source.collection_id == record.collection_id
                and source.page_number == record.page_number
                and source.page_number >= 1
                and source.excerpt
                and source.excerpt in record.text
                and (body.collection_id is None or source.collection_id == body.collection_id)
                and (body.document_id is None or source.document_id == body.document_id)
            )
        session.rollback()
        if not valid:
            raise api_error(
                409,
                "evidence_changed",
                "Source passages changed or are unavailable. Retry the question.",
            )


def get_citation_verifier(request: Request) -> CitationVerifier:
    return request.app.state.citation_verifier
