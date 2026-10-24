"""Child-process extraction protocol. PDF text is data, never instructions or markup."""

import hashlib
import json
import sys
from pathlib import Path

import pymupdf

from app.services.chunking import chunk_page, normalize_text


class ExtractionError(Exception):
    pass


def extract(path: Path, limits: dict, checksum: str) -> dict:
    if path.stat().st_size > limits["max_upload_bytes"]:
        raise ExtractionError("limits")
    # Check integrity before parsing; never process a silently replaced stored PDF.
    with path.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != checksum:
            raise ExtractionError("integrity")
    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)
    chunks = []
    total = output_chars = 0
    with pymupdf.open(path) as pdf:
        if (
            not pdf.is_pdf
            or pdf.needs_pass
            or pdf.is_encrypted
            or pdf.is_repaired
            or pdf.xref_get_key(-1, "Encrypt")[0] != "null"
            or not 1 <= pdf.page_count <= limits["max_pdf_pages"]
        ):
            raise ExtractionError("invalid")
        for number, page in enumerate(pdf, 1):
            # blocks avoid extracting images; block separation preserves useful paragraphs.
            blocks = page.get_text(
                "blocks", sort=True, flags=pymupdf.TEXTFLAGS_BLOCKS & ~pymupdf.TEXT_PRESERVE_IMAGES
            )
            raw = "\n\n".join(b[4] for b in blocks if b[6] == 0)
            total += len(raw)
            if len(raw) > limits["max_page_text_chars"] or total > limits["max_extracted_chars"]:
                raise ExtractionError("limits")
            text = normalize_text(raw)
            for chunk in chunk_page(
                text, number, limits["chunk_size_chars"], limits["chunk_overlap_chars"]
            ):
                output_chars += len(chunk.text)
                if (
                    len(chunks) >= limits["max_document_chunks"]
                    or output_chars > limits["max_extracted_chars"] * 2
                ):
                    raise ExtractionError("limits")
                chunks.append(
                    {
                        "page_number": number,
                        "chunk_index": len(chunks),
                        "text": chunk.text,
                        "start_char": chunk.start_char,
                        "end_char": chunk.end_char,
                    }
                )
        if pdf.is_repaired:
            raise ExtractionError("invalid")
        return {"page_count": pdf.page_count, "chunks": chunks}


if __name__ == "__main__":
    try:
        # A hard address-space ceiling is available on Linux containers. Windows is
        # bounded by timeout, input/page/text/output limits and one parser per app.
        if sys.platform == "linux":
            import resource

            resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
        result = extract(Path(sys.argv[1]), json.loads(sys.argv[2]), sys.argv[3])
        print(json.dumps(result, ensure_ascii=True))
    except Exception:
        # Never serialize native parser messages, source text, paths or tracebacks.
        raise SystemExit(1) from None
