"""Bounded synchronous processing with committed claims and atomic replacement."""

import json
import subprocess
import sys
from datetime import timedelta
from pathlib import Path
from threading import BoundedSemaphore
from time import monotonic
from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import delete, or_, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import api_error
from app.core.logging import operation_timing
from app.models import Document, DocumentChunk
from app.models.library import utc_now
from app.services.library import require_document
from app.services.storage import DocumentStorage


class ExtractedChunk(BaseModel):
    page_number: int = Field(ge=1)
    chunk_index: int = Field(ge=0)
    start_char: int = Field(ge=0)
    end_char: int = Field(gt=0)
    text: str = Field(min_length=1)


class ExtractionResult(BaseModel):
    page_count: int = Field(ge=1)
    chunks: list[ExtractedChunk]


class ProcessingFailure(Exception):
    pass


class PdfProcessor:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.slot = BoundedSemaphore(1)

    def extract(self, path: Path, checksum: str) -> ExtractionResult:
        limits = self.settings.model_dump(
            include={
                "max_upload_bytes",
                "max_pdf_pages",
                "max_page_text_chars",
                "max_extracted_chars",
                "chunk_size_chars",
                "chunk_overlap_chars",
                "max_document_chunks",
            }
        )
        try:
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "app.services.pdf_extraction",
                    str(path),
                    json.dumps(limits),
                    checksum,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=self.settings.processing_timeout_seconds,
                cwd=Path(__file__).resolve().parents[2],
                **(
                    {"creationflags": subprocess.CREATE_NO_WINDOW}
                    if sys.platform == "win32"
                    else {}
                ),
            )
            if result.returncode:
                raise ProcessingFailure
            data = ExtractionResult.model_validate_json(result.stdout)
            if (
                data.page_count > limits["max_pdf_pages"]
                or len(data.chunks) > limits["max_document_chunks"]
            ):
                raise ProcessingFailure
            if sum(len(c.text) for c in data.chunks) > limits["max_extracted_chars"] * 2:
                raise ProcessingFailure
            for index, chunk in enumerate(data.chunks):
                if (
                    chunk.chunk_index != index
                    or chunk.page_number > data.page_count
                    or chunk.end_char - chunk.start_char != len(chunk.text)
                    or not chunk.text.strip()
                    or len(chunk.text) > limits["chunk_size_chars"]
                ):
                    raise ProcessingFailure
            return data
        except (OSError, subprocess.SubprocessError, ValidationError, ValueError):
            raise ProcessingFailure from None


def get_processor(request: Request) -> PdfProcessor:
    return request.app.state.processor


def process_document(
    session: Session, storage: DocumentStorage, processor: PdfProcessor, identifier: UUID
) -> Document:
    require_document(session, identifier)
    if not processor.slot.acquire(blocking=False):
        raise api_error(409, "processor_busy", "Another PDF is being processed; try again shortly")
    token = uuid4()
    claimed = False
    started, completed = monotonic(), False
    try:
        now = utc_now()
        # Stale recovery accounts for the parser timeout plus transaction/cleanup grace.
        cutoff = now - timedelta(seconds=processor.settings.processing_timeout_seconds + 60)
        claim = session.execute(
            update(Document)
            .where(
                Document.id == identifier,
                or_(
                    Document.processing_status != "processing",
                    Document.processing_started_at < cutoff,
                    Document.processing_started_at.is_(None),
                ),
            )
            .values(
                processing_status="processing",
                processing_started_at=now,
                processing_token=token,
                processing_error=None,
                processed_at=None,
                indexing_status="not_indexed",
                indexing_token=None,
                indexing_error=None,
                indexed_at=None,
                indexed_chunk_count=0,
                embedding_model=None,
                embedding_digest=None,
                embedding_dimensions=None,
                embedding_fingerprint=None,
            )
        )
        if claim.rowcount != 1:
            session.rollback()
            raise api_error(
                409, "document_processing", "Document is already processing; refresh its status"
            )
        # Invalidate any previous extraction in the same transaction as the claim.
        session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == identifier))
        session.execute(
            update(Document).where(Document.id == identifier).values(chunk_count=0, page_count=None)
        )
        session.commit()
        claimed = True
        document = require_document(session, identifier)
        path = storage.path_for(document.storage_key)
        checksum = document.checksum
        session.rollback()  # No open database transaction while the parser is running.
        data = processor.extract(path, checksum)
        document = require_document(session, identifier, lock=True)
        if document.processing_token != token:
            raise api_error(
                409, "processing_replaced", "A newer processing attempt replaced this result"
            )
        session.add_all(
            [DocumentChunk(document_id=identifier, **chunk.model_dump()) for chunk in data.chunks]
        )
        document.page_count = data.page_count
        document.chunk_count = len(data.chunks)
        document.chunk_size_chars = processor.settings.chunk_size_chars
        document.chunk_overlap_chars = processor.settings.chunk_overlap_chars
        document.processing_status = "processed" if data.chunks else "no_text"
        document.processed_at = utc_now()
        document.processing_token = None
        session.commit()
        completed = True
        return document
    except (ProcessingFailure, SQLAlchemyError, OSError):
        session.rollback()
        if claimed:
            # Conditional update prevents an old worker from changing a newer attempt.
            session.execute(
                update(Document)
                .where(
                    Document.id == identifier,
                    Document.processing_token == token,
                )
                .values(
                    processing_status="failed",
                    processing_token=None,
                    processing_error=(
                        "Text extraction failed or exceeded processing limits. "
                        "Retry or use a simpler PDF."
                    ),
                    chunk_count=0,
                    page_count=None,
                )
            )
            session.commit()
        raise api_error(
            422,
            "processing_failed",
            "Text extraction failed or exceeded processing limits. Retry or use a simpler PDF.",
        ) from None
    finally:
        processor.slot.release()
        operation_timing("processing", started, completed=completed)
