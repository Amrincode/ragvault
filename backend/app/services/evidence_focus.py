"""Bounded English category/page-limit heuristics, not general relevance verification."""

import re

from app.schemas.search import SearchHit

CATEGORY = re.compile(r"\b([a-z][a-z0-9-]*)\s+category\b", re.IGNORECASE)
NON_LABELS = {"a", "the", "which", "what", "each", "any", "either", "both", "this", "that"}


def category_labels(text: str) -> set[str]:
    return {m[1].casefold() for m in CATEGORY.finditer(text)} - NON_LABELS


def requested_category(question: str) -> str | None:
    labels = category_labels(question)
    # Comparison/compound questions need more than this deliberately narrow parser.
    if len(labels) != 1 or re.search(r"\b(and|or|versus|vs)\b", question, re.IGNORECASE):
        return None
    return next(iter(labels))


def page_limit_question(question: str) -> bool:
    return bool(
        re.search(r"\bpages?\b", question, re.IGNORECASE)
        and re.search(r"\b(maximum|max|limit|count|length)\b|how many", question, re.IGNORECASE)
    )


def report_contents_question(question: str) -> bool:
    return bool(
        re.search(r"\breport\b", question, re.IGNORECASE)
        and re.search(r"\b(include|contain|contents|sections|cover)\b", question, re.IGNORECASE)
    )


def category_page_hits(question: str, hits: list[SearchHit]) -> list[SearchHit]:
    """Stable priority inside retrieved top-K; no new search, text rewriting or extra budget."""
    if report_contents_question(question):
        # Section wording is a stronger local signal than a near-tied generic aim.
        return sorted(
            hits,
            key=lambda hit: (
                not bool(
                    re.search(
                        r"\breport\b.{0,100}\b(?:should|must)\s+(?:include|contain|cover)\b",
                        " ".join(hit.excerpt.split()),
                        re.IGNORECASE,
                    )
                )
            ),
        )
    label = requested_category(question)
    if not label or not page_limit_question(question):
        return hits
    pattern = re.compile(
        r"\b" + re.escape(label) + r"\s+category\s*:?[^.!?]{0,240}\bpages?\b",
        re.IGNORECASE,
    )
    return sorted(hits, key=lambda hit: not bool(pattern.search(hit.excerpt)))


def question_scope_issue(question: str, claim: str, evidence: list[str]) -> str | None:
    """A source-valid claim may still answer the wrong category or numeric field."""
    label = requested_category(question)
    if label:
        known = set().union(*(category_labels(text) for text in evidence))
        if not re.search(r"\b" + re.escape(label) + r"\b", claim, re.IGNORECASE) or any(
            re.search(r"\b" + re.escape(other) + r"\b", claim, re.IGNORECASE)
            for other in known - {label}
        ):
            return "requested_category_not_matched"
    if page_limit_question(question) and not re.search(r"\bpages?\b", claim, re.IGNORECASE):
        return "requested_page_limit_not_matched"
    return None
