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
        and re.search(
            r"\b(include|contain|contents|sections|cover|requirements)\b", question, re.IGNORECASE
        )
    )


def focus_question(question: str, history: list[str] | None = None) -> str:
    """Resolve a narrow category reference from the latest user topic, never assistant facts."""
    if requested_category(question) or not re.search(
        r"\b(its|it|those|these|them)\b", question, re.I
    ):
        return question
    for topic in reversed(history or []):
        if label := requested_category(topic):
            return question + f" (topic: {label} category report)"
        # Do not jump across a newer explicit but ambiguous category comparison.
        if category_labels(topic) or not re.search(r"\b(its|it|those|these|them)\b", topic, re.I):
            break
    return question


def category_sections(text: str) -> list[tuple[str, int, int]]:
    """Only explicit 'label category:' headings establish a section boundary."""
    headings = list(re.finditer(r"\b([a-z][a-z0-9-]*)\s+category\s*:", text, re.I))
    return [
        (
            m[1].casefold(),
            m.start(),
            headings[i + 1].start() if i + 1 < len(headings) else len(text),
        )
        for i, m in enumerate(headings)
    ]


def focused_excerpt(question: str, text: str) -> str:
    label = requested_category(question)
    if label and (report_contents_question(question) or page_limit_question(question)):
        sections = [(start, end) for name, start, end in category_sections(text) if name == label]
        if len(sections) == 1:
            start, end = sections[0]
            # A report section ends at this explicit next deliverable heading.
            boundary = re.search(r"\n\s*Presentation Slide\s*\n", text[start:end], re.I)
            if boundary:
                end = start + boundary.start()
            return text[start:end].strip()
    return text


def category_quote_matches(label: str, quote: str, source: str, *, report: bool = False) -> bool:
    """Every occurrence must belong to that explicit heading; duplicated mixed sections abstain."""
    positions = [m.start() for m in re.finditer(re.escape(quote), source)]
    sections = category_sections(source)
    return bool(positions) and all(
        any(
            name == label
            and start <= pos
            and pos + len(quote) <= end
            and (not report or re.search(r"\breports?\b", source[start : pos + len(quote)], re.I))
            for name, start, end in sections
        )
        for pos in positions
    )


def category_page_hits(question: str, hits: list[SearchHit]) -> list[SearchHit]:
    """Stable priority inside retrieved top-K; no new search, text rewriting or extra budget."""
    label = requested_category(question)
    if label and page_limit_question(question):
        pattern = re.compile(
            r"\b" + re.escape(label) + r"\s+category\s*:[^.!?]{0,240}\bpages?\b", re.I
        )
        return sorted(hits, key=lambda hit: not bool(pattern.search(hit.excerpt)))
    if label and report_contents_question(question):
        return sorted(
            hits,
            key=lambda hit: not any(name == label for name, _, _ in category_sections(hit.excerpt)),
        )
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
