import hashlib
import json
import logging
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from threading import BoundedSemaphore
from typing import BinaryIO
from uuid import uuid4

from fastapi import Request, UploadFile

from app.core.config import Settings
from app.core.errors import api_error
from app.schemas.library import safe_pdf_name

logger = logging.getLogger(__name__)


@dataclass
class StagedPDF:
    path: Path
    filename: str
    size: int
    checksum: str


class DocumentStorage:
    def __init__(self, settings: Settings) -> None:
        configured_root = settings.upload_dir.expanduser().absolute()
        if self._is_link(configured_root):
            raise ValueError("Upload directory must not be a symbolic link")
        self.root = configured_root.resolve()
        self.temporary = self.root / ".tmp"
        self.trash = self.root / ".trash"
        self.max_bytes = settings.max_upload_bytes
        self.max_pages = settings.max_pdf_pages
        self.validation_timeout = settings.pdf_validation_timeout_seconds
        self._validation_slot = BoundedSemaphore(1)
        for directory in (self.root, self.temporary, self.trash):
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            if self._is_link(directory) or directory.resolve().parent != (
                self.root.parent if directory == self.root else self.root
            ):
                raise ValueError("Upload directories must not be symbolic links")

    @staticmethod
    def _is_link(path: Path) -> bool:
        return path.is_symlink() or path.is_junction()

    def _check_directories(self) -> None:
        # Recheck before use, not only at startup. This detects a replaced root,
        # staging or trash directory, including Windows junctions. Storage remains
        # trusted: pathname checks cannot defeat a hostile owner racing each I/O.
        for directory in (self.root, self.temporary, self.trash):
            if (
                self._is_link(directory)
                or not directory.is_dir()
                or directory.resolve() != directory
            ):
                raise OSError("Unsafe upload storage directories")

    def _check_private_path(self, path: Path, parent: Path, suffix: str) -> None:
        self._check_directories()
        if (
            path.parent != parent
            or not re.fullmatch(r"[0-9a-f]{32}" + re.escape(suffix), path.name)
            or self._is_link(path)
            or path.resolve().parent != parent
        ):
            raise OSError("Unsafe internal storage path")

    def path_for(self, key: str) -> Path:
        self._check_directories()
        if not re.fullmatch(r"[0-9a-f]{32}\.pdf", key):
            raise api_error(500, "invalid_storage_reference", "Invalid internal storage reference")
        path = self.root / key
        if self._is_link(path) or path.resolve().parent != self.root:
            raise api_error(500, "unsafe_storage_reference", "Unsafe internal storage reference")
        return path

    def cleanup(self, path: Path) -> None:
        try:
            parent = path.parent
            if parent not in (self.root, self.temporary, self.trash):
                raise OSError("Cleanup path is outside upload storage")
            self._check_private_path(path, parent, ".tmp" if parent == self.temporary else ".pdf")
            path.unlink(missing_ok=True)
        except OSError as exc:
            logger.error(
                "Storage cleanup requires attention", extra={"error_type": type(exc).__name__}
            )

    def stage(self, upload: UploadFile) -> StagedPDF:
        try:
            filename = safe_pdf_name(upload.filename or "", upload=True)
        except ValueError as exc:
            raise api_error(415, "unsupported_filename", str(exc)) from None
        path = self.temporary / f"{uuid4().hex}.tmp"
        try:
            self._check_private_path(path, self.temporary, ".tmp")
            digest = hashlib.sha256()
            size = 0
            # Mode applies to new files only; existing storage/ACLs are untouched.
            with open(
                path, "xb", opener=lambda name, flags: os.open(name, flags, 0o600)
            ) as destination:
                while chunk := upload.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.max_bytes:
                        raise api_error(
                            413, "upload_too_large", f"PDF exceeds the {self.max_bytes}-byte limit"
                        )
                    destination.write(chunk)
                    digest.update(chunk)
            with path.open("rb") as source:
                if source.read(5) != b"%PDF-":
                    raise api_error(
                        422, "invalid_pdf_signature", "File does not have a PDF signature"
                    )
            self.validate_pdf(path)
            return StagedPDF(path, filename, size, digest.hexdigest())
        except BaseException:
            self.cleanup(path)
            raise

    def validate_pdf(self, path: Path) -> None:
        self._check_private_path(path, self.temporary, ".tmp")
        if not self._validation_slot.acquire(blocking=False):
            raise api_error(409, "validator_busy", "Another PDF is being validated; please retry")
        try:
            self._validate_pdf(path)
        finally:
            self._validation_slot.release()

    def _validate_pdf(self, path: Path) -> None:
        try:
            # PyMuPDF does not support concurrent thread use. Each synchronous child
            # owns its native parser and can be stopped without crashing the API.
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "app.services.pdf_validation",
                    str(path),
                    str(self.max_pages),
                    str(self.max_bytes),
                ],
                capture_output=True,
                text=True,
                timeout=self.validation_timeout,
                cwd=Path(__file__).resolve().parents[2],
                **(
                    {"creationflags": subprocess.CREATE_NO_WINDOW}
                    if sys.platform == "win32"
                    else {}
                ),
            )
        except subprocess.TimeoutExpired:
            raise api_error(
                422, "pdf_validation_timeout", "PDF validation timed out; try a simpler PDF"
            ) from None
        except OSError as exc:
            logger.error("PDF validator could not start", extra={"error_type": type(exc).__name__})
            raise api_error(
                503, "validator_unavailable", "PDF validation is unavailable; please retry"
            ) from None
        try:
            outcome = json.loads(result.stdout)
            if result.returncode == 0 and outcome["code"] == "ok":
                return
            if result.returncode == 1 and outcome["code"] in {
                "invalid_pdf",
                "encrypted_pdf",
                "corrupted_pdf",
                "too_many_pages",
                "upload_too_large",
            }:
                raise api_error(
                    413 if outcome["code"] == "upload_too_large" else 422,
                    outcome["code"],
                    outcome["message"],
                )
        except (ValueError, KeyError, TypeError):
            pass
        logger.error("PDF validator failed", extra={"error_type": "ParserProcessFailure"})
        raise api_error(503, "validator_failed", "PDF validation failed; please retry")

    def promote(self, staged: StagedPDF, key: str) -> Path:
        self._check_private_path(staged.path, self.temporary, ".tmp")
        destination = self.path_for(key)
        if destination.exists():
            raise OSError("Storage UUID collision")
        staged.path.rename(destination)
        return destination

    def open_pdf(self, key: str) -> BinaryIO:
        return self.path_for(key).open("rb")

    def quarantine(self, key: str) -> Path | None:
        source = self.path_for(key)
        if not source.exists():
            logger.warning("Document file already missing")
            return None
        destination = self.trash / key
        self._check_private_path(destination, self.trash, ".pdf")
        if destination.exists():
            raise OSError("An earlier delete requires storage recovery")
        source.rename(destination)
        return destination

    def restore(self, quarantined: Path, key: str) -> None:
        self._check_private_path(quarantined, self.trash, ".pdf")
        quarantined.rename(self.path_for(key))


def get_storage(request: Request) -> DocumentStorage:
    return request.app.state.storage
