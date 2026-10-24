"""Synchronous parser subprocess protocol; never echo PDF contents or exception details."""

import json
import sys
from pathlib import Path

import pymupdf


def validate(path: Path, max_pages: int, max_bytes: int) -> tuple[str, str]:
    if path.stat().st_size > max_bytes:
        return "upload_too_large", "PDF exceeds the configured byte limit"
    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)
    try:
        with pymupdf.open(stream=path.read_bytes(), filetype="pdf") as pdf:
            if not pdf.is_pdf:
                return "invalid_pdf", "File is not a PDF"
            if pdf.needs_pass or pdf.is_encrypted or pdf.xref_get_key(-1, "Encrypt")[0] != "null":
                return (
                    "encrypted_pdf",
                    "Encrypted PDFs are not supported; upload an unencrypted copy",
                )
            if pdf.is_repaired or pdf.page_count < 1:
                return "corrupted_pdf", "PDF is damaged or has no pages"
            if pdf.page_count > max_pages:
                return "too_many_pages", f"PDF exceeds the {max_pages}-page limit"
            for page_number in range(pdf.page_count):
                pdf.load_page(page_number)
            if pdf.is_repaired:
                return "corrupted_pdf", "PDF required repairs during validation"
    except (pymupdf.FileDataError, pymupdf.EmptyFileError, RuntimeError, ValueError):
        return "corrupted_pdf", "PDF could not be validated"
    return "ok", "PDF validated"


if __name__ == "__main__":
    try:
        code, message = validate(Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]))
        print(json.dumps({"code": code, "message": message}))
        raise SystemExit(0 if code == "ok" else 1)
    except Exception:
        print(json.dumps({"code": "validator_failed", "message": "PDF validation is unavailable"}))
        raise SystemExit(2) from None
