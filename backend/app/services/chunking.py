"""Deterministic character windows over normalized individual pages; no model calls."""

import re
import unicodedata
from dataclasses import dataclass


def normalize_text(text: str) -> str:
    # Keep Unicode, punctuation and paragraph boundaries; do not guess dehyphenation.
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(c for c in text if c in "\n\t" or unicodedata.category(c) not in {"Cc", "Cs"})
    paragraphs = re.split(r"\n\s*\n", text)
    return "\n\n".join(p for part in paragraphs if (p := re.sub(r"\s+", " ", part).strip()))


@dataclass(frozen=True)
class TextChunk:
    page_number: int
    start_char: int
    end_char: int
    text: str


def chunk_page(
    text: str, page_number: int, size: int = 1200, overlap: int = 200
) -> list[TextChunk]:
    if size < 1 or not 0 <= overlap < size or page_number < 1:
        raise ValueError("Invalid chunking parameters")
    chunks = []
    start = 0
    previous_end = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            floor = max(start + size // 2, previous_end + 1)
            # Prefer paragraph, then sentence, then word boundaries in the latter half.
            for pattern in (r"\n\n", r"[.!?]\s+", r"\s+"):
                boundaries = [m.end() for m in re.finditer(pattern, text[start:end])]
                candidates = [start + b for b in boundaries if start + b >= floor]
                if candidates:
                    end = candidates[-1]
                    break
        left, right = start, end
        while left < right and text[left].isspace():
            left += 1
        while right > left and text[right - 1].isspace():
            right -= 1
        if right > left and right > previous_end:
            chunks.append(TextChunk(page_number, left, right, text[left:right]))
        previous_end = end
        if end == len(text):
            break
        next_start = max(start + 1, end - overlap)
        # Align overlap forward to a word boundary; never lose unconsumed content.
        if next_start > 0 and not text[next_start - 1].isspace():
            boundary = re.search(r"\s+", text[next_start:end])
            if boundary:
                next_start += boundary.end()
            elif overlap:
                next_start = end
        start = next_start
    return chunks
