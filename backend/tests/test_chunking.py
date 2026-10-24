import pytest

from app.services.chunking import chunk_page, normalize_text


def test_normalization_preserves_paragraphs_unicode_and_punctuation():
    assert (
        normalize_text("  Résumé\t title\r\nwrapped line\n\n New paragraph!\x00 ")
        == "Résumé title wrapped line\n\nNew paragraph!"
    )
    assert normalize_text("join\u200dword") == "join\u200dword"


@pytest.mark.parametrize("text", ["", "   \n\t", "A short page.", "word " * 1000, "x" * 3000])
@pytest.mark.parametrize("overlap", [0, 30, 100])
def test_bounded_deterministic_chunks_cover_entire_page(text, overlap):
    text = normalize_text(text)
    chunks = chunk_page(text, 3, size=128, overlap=overlap)
    assert chunks == chunk_page(text, 3, size=128, overlap=overlap)
    assert len({(c.start_char, c.end_char) for c in chunks}) == len(chunks)
    covered = set()
    previous_end = 0
    for chunk in chunks:
        assert chunk.page_number == 3 and 0 < len(chunk.text) <= 128
        assert chunk.text == text[chunk.start_char : chunk.end_char]
        assert chunk.end_char > previous_end
        covered.update(range(chunk.start_char, chunk.end_char))
        previous_end = chunk.end_char
    assert all(i in covered for i, char in enumerate(text) if not char.isspace())


def test_word_boundaries_and_overlap_are_preserved():
    text = " ".join(f"word{i:03}" for i in range(100))
    chunks = chunk_page(text, 1, 128, 30)
    assert len(chunks) > 2
    assert all(c.text.startswith("word") and len(c.text.split()[-1]) == 7 for c in chunks)
    assert all(b.start_char < a.end_char for a, b in zip(chunks, chunks[1:], strict=False))


@pytest.mark.parametrize("size,overlap,page", [(0, 0, 1), (10, 10, 1), (10, -1, 1), (10, 1, 0)])
def test_invalid_chunk_settings(size, overlap, page):
    with pytest.raises(ValueError):
        chunk_page("text", page, size, overlap)
