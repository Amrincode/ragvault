import hashlib
import subprocess
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pymupdf
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.base import Base
from app.main import create_app
from app.models import Document
from app.services.storage import DocumentStorage


@pytest.fixture
def pdf_bytes() -> bytes:
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((72, 72), "Isolated RAGVault PDF fixture")
        return pdf.tobytes()


@pytest.fixture
def library_client(settings: Settings, tmp_path: Path) -> Iterator[TestClient]:
    isolated = settings.model_copy(update={"max_upload_bytes": 4096})
    engine = create_engine(
        f"sqlite:///{tmp_path / 'library.sqlite'}", connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, record) -> None:
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with patch("app.main.build_engine", return_value=engine):
        with TestClient(create_app(isolated)) as client:
            yield client


def collection(client: TestClient, name: str = "Research") -> dict:
    response = client.post("/api/collections", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def upload(
    client: TestClient,
    collection_id: str,
    payload: bytes,
    filename: str = "paper.pdf",
    mime: str = "application/pdf",
):
    return client.post(
        f"/api/collections/{collection_id}/documents", files={"file": (filename, payload, mime)}
    )


def stored_files(client: TestClient) -> list[Path]:
    return list(client.app.state.storage.root.rglob("*.pdf")) + list(
        client.app.state.storage.temporary.iterdir()
    )


def test_collection_crud_and_case_insensitive_duplicate(library_client: TestClient) -> None:
    first = collection(library_client, "  Research  ")
    assert first["name"] == "Research" and first["document_count"] == 0
    assert first["created_at"].endswith("Z")
    assert library_client.post("/api/collections", json={"name": "research"}).status_code == 409
    second = collection(library_client, "Personal")
    assert len(library_client.get("/api/collections").json()) == 2
    response = library_client.patch(f"/api/collections/{first['id']}", json={"name": "References"})
    assert response.status_code == 200 and response.json()["name"] == "References"
    assert (
        library_client.patch(
            f"/api/collections/{first['id']}", json={"name": "personal"}
        ).status_code
        == 409
    )
    assert library_client.delete(f"/api/collections/{second['id']}").status_code == 204
    assert library_client.delete(f"/api/collections/{second['id']}").status_code == 404


@pytest.mark.parametrize("name", ["", "  ", "a" * 121, "bad\nname", "bad\x00name"])
def test_invalid_collection_names(library_client: TestClient, name: str) -> None:
    assert library_client.post("/api/collections", json={"name": name}).status_code == 422


def test_document_crud_preview_download_and_collection_safety(
    library_client: TestClient, pdf_bytes: bytes
) -> None:
    item = collection(library_client)
    result = upload(library_client, item["id"], pdf_bytes, "../folder/report.PDF", "text/plain")
    assert result.status_code == 201, result.text
    document = result.json()
    assert document["filename"] == "report.PDF"
    assert document["mime_type"] == "application/pdf"
    assert document["file_size"] == len(pdf_bytes)
    assert document["checksum"] == hashlib.sha256(pdf_bytes).hexdigest()
    assert document["processing_status"] == "uploaded"
    assert "storage_key" not in document
    identifier = document["id"]
    paths = stored_files(library_client)
    assert len(paths) == 1 and paths[0].name == identifier.replace("-", "") + ".pdf"
    assert paths[0].read_bytes() == pdf_bytes
    assert library_client.get(f"/api/documents/{identifier}").json()["filename"] == "report.PDF"
    assert library_client.get("/api/collections").json()[0]["document_count"] == 1
    assert library_client.delete(f"/api/collections/{item['id']}").status_code == 409
    renamed = library_client.patch(f"/api/documents/{identifier}", json={"filename": "Résumé.pdf"})
    assert renamed.status_code == 200 and renamed.json()["filename"] == "Résumé.pdf"
    preview = library_client.get(f"/api/documents/{identifier}/file")
    assert preview.status_code == 200 and preview.content == pdf_bytes
    assert preview.headers["content-type"] == "application/pdf"
    assert preview.headers["content-disposition"].startswith("inline;")
    assert "R%C3%A9sum%C3%A9.pdf" in preview.headers["content-disposition"]
    assert preview.headers["x-content-type-options"] == "nosniff"
    assert "no-store" in preview.headers["cache-control"]
    assert (
        library_client.get(f"/api/documents/{identifier}/file?download=true")
        .headers["content-disposition"]
        .startswith("attachment;")
    )
    assert library_client.delete(f"/api/documents/{identifier}").status_code == 204
    assert not stored_files(library_client)
    assert library_client.get(f"/api/documents/{identifier}").status_code == 404
    assert library_client.delete(f"/api/collections/{item['id']}").status_code == 204


def test_duplicates_are_per_collection_and_cleanup(
    library_client: TestClient, pdf_bytes: bytes
) -> None:
    first = collection(library_client)
    second = collection(library_client, "Other")
    assert upload(library_client, first["id"], pdf_bytes).status_code == 201
    duplicate = upload(library_client, first["id"], pdf_bytes, "different-name.pdf")
    assert (
        duplicate.status_code == 409 and duplicate.json()["detail"]["code"] == "duplicate_document"
    )
    assert upload(library_client, second["id"], pdf_bytes).status_code == 201
    assert len(stored_files(library_client)) == 2
    assert not list(library_client.app.state.storage.temporary.iterdir())
    assert library_client.get("/api/documents").json()["total"] == 2
    assert library_client.get(f"/api/documents?collection_id={first['id']}").json()["total"] == 1
    page = library_client.get("/api/documents?limit=1&offset=1").json()
    assert len(page["items"]) == 1 and page["total"] == 2


@pytest.mark.parametrize(
    "filename,payload,expected,code",
    [
        ("image.png", b"fake", 415, "unsupported_filename"),
        ("fake.pdf", b"not a PDF", 422, "invalid_pdf_signature"),
        ("empty.pdf", b"", 422, "invalid_pdf_signature"),
        ("broken.pdf", b"%PDF-1.7\nnot a valid document", 422, "corrupted_pdf"),
        ("large.pdf", b"%PDF-" + b"a" * 5000, 413, "upload_too_large"),
        ("bad\r\nname.pdf", b"%PDF-", 415, "unsupported_filename"),
    ],
)
def test_rejected_uploads_leave_no_rows_or_files(
    library_client: TestClient, filename: str, payload: bytes, expected: int, code: str
) -> None:
    item = collection(library_client)
    result = upload(library_client, item["id"], payload, filename)
    assert result.status_code == expected, result.text
    assert result.json()["detail"]["code"] == code
    assert library_client.get("/api/documents").json()["total"] == 0
    assert not stored_files(library_client)


@pytest.mark.parametrize("password", ["", "private"])
def test_encrypted_pdf_rejected_even_without_open_password(
    library_client: TestClient, password: str
) -> None:
    with pymupdf.open() as pdf:
        pdf.new_page()
        encrypted = pdf.tobytes(
            encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner-only", user_pw=password
        )
    item = collection(library_client)
    result = upload(library_client, item["id"], encrypted)
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "encrypted_pdf"
    assert not stored_files(library_client)


def test_missing_collection_and_validation_errors(
    library_client: TestClient, pdf_bytes: bytes
) -> None:
    missing = str(uuid4())
    assert upload(library_client, missing, pdf_bytes).status_code == 404
    assert library_client.get(f"/api/documents?collection_id={missing}").status_code == 404
    assert (
        library_client.patch(f"/api/collections/{missing}", json={"name": "Name"}).status_code
        == 404
    )
    assert library_client.get("/api/documents/not-a-uuid").status_code == 422
    assert library_client.get(f"/api/documents/{missing}").status_code == 404
    assert library_client.delete(f"/api/documents/{missing}").status_code == 404
    assert library_client.get("/api/documents?limit=101").status_code == 422
    assert library_client.get("/api/documents?offset=-1").status_code == 422
    assert library_client.get("/api/library/config").json()["max_upload_bytes"] == 4096


@pytest.mark.parametrize("filename", ["../escape.pdf", "not-pdf.txt", "bad\r\n.pdf", "a" * 256])
def test_rename_rejects_unsafe_names(
    library_client: TestClient, pdf_bytes: bytes, filename: str
) -> None:
    item = collection(library_client)
    document = upload(library_client, item["id"], pdf_bytes).json()
    assert (
        library_client.patch(
            f"/api/documents/{document['id']}", json={"filename": filename}
        ).status_code
        == 422
    )


def test_upload_commit_failure_cleans_promoted_file(
    library_client: TestClient, pdf_bytes: bytes
) -> None:
    item = collection(library_client)
    with patch.object(
        Session, "commit", side_effect=OperationalError("commit", {}, Exception("private details"))
    ):
        result = upload(library_client, item["id"], pdf_bytes)
    assert result.status_code == 503 and "private details" not in result.text
    assert library_client.get("/api/documents").json()["total"] == 0
    assert not stored_files(library_client)


def test_storage_write_failure_rolls_back_metadata(
    library_client: TestClient, pdf_bytes: bytes
) -> None:
    item = collection(library_client)
    with patch.object(DocumentStorage, "promote", side_effect=OSError("disk error")):
        result = upload(library_client, item["id"], pdf_bytes)
    assert result.status_code == 503
    assert library_client.get("/api/documents").json()["total"] == 0
    assert not stored_files(library_client)


def test_delete_commit_failure_restores_file(library_client: TestClient, pdf_bytes: bytes) -> None:
    item = collection(library_client)
    document = upload(library_client, item["id"], pdf_bytes).json()
    with patch.object(
        Session, "commit", side_effect=OperationalError("commit", {}, Exception("failure"))
    ):
        result = library_client.delete(f"/api/documents/{document['id']}")
    assert result.status_code == 503
    assert library_client.get(f"/api/documents/{document['id']}/file").content == pdf_bytes
    assert len(stored_files(library_client)) == 1
    assert not list(library_client.app.state.storage.trash.iterdir())


def test_delete_move_failure_keeps_record_and_file(
    library_client: TestClient, pdf_bytes: bytes
) -> None:
    item = collection(library_client)
    document = upload(library_client, item["id"], pdf_bytes).json()
    with patch.object(DocumentStorage, "quarantine", side_effect=PermissionError("in use")):
        result = library_client.delete(f"/api/documents/{document['id']}")
    assert result.status_code == 503
    assert library_client.get(f"/api/documents/{document['id']}/file").content == pdf_bytes


def test_missing_file_can_be_removed_from_library(
    library_client: TestClient, pdf_bytes: bytes
) -> None:
    item = collection(library_client)
    document = upload(library_client, item["id"], pdf_bytes).json()
    stored_files(library_client)[0].unlink()
    assert library_client.get(f"/api/documents/{document['id']}/file").status_code == 404
    assert library_client.delete(f"/api/documents/{document['id']}").status_code == 204


def test_metadata_persists_between_database_sessions(
    library_client: TestClient, pdf_bytes: bytes
) -> None:
    item = collection(library_client)
    document = upload(library_client, item["id"], pdf_bytes).json()
    with Session(library_client.app.state.engine) as session:
        persisted = session.scalar(
            select(Document).where(Document.checksum == hashlib.sha256(pdf_bytes).hexdigest())
        )
        assert str(persisted.id) == document["id"]
    assert library_client.get(f"/api/documents/{document['id']}").status_code == 200


def test_storage_rejects_tampered_paths(library_client: TestClient, tmp_path: Path) -> None:
    outside = tmp_path / "preserve.pdf"
    outside.write_bytes(b"untouched")
    with pytest.raises(Exception) as error:
        library_client.app.state.storage.path_for("../../preserve.pdf")
    assert error.value.status_code == 500
    assert outside.read_bytes() == b"untouched"


def test_request_limit_rejects_declared_and_chunked_bodies(library_client: TestClient) -> None:
    item = collection(library_client)
    url = f"/api/collections/{item['id']}/documents"
    headers = {"Content-Type": "multipart/form-data; boundary=test"}
    result = library_client.post(url, content=b"x" * 100_000, headers=headers)
    assert result.status_code == 413
    result = library_client.post(url, content=iter([b"x" * 40_000, b"y" * 40_000]), headers=headers)
    assert result.status_code == 413, result.text
    assert not stored_files(library_client)


def test_browser_write_origin_and_host_validation(library_client: TestClient) -> None:
    blocked = library_client.post(
        "/api/collections",
        json={"name": "Blocked"},
        headers={"Origin": "https://untrusted.example"},
    )
    assert blocked.status_code == 403
    assert library_client.get("/api/collections").json() == []
    assert (
        library_client.post(
            "/api/collections",
            json={"name": "Allowed"},
            headers={"Origin": "http://localhost:5173"},
        ).status_code
        == 201
    )
    assert (
        library_client.get("/api/collections", headers={"Host": "untrusted.example"}).status_code
        == 400
    )


def test_pdf_page_limit_and_repaired_pdf_cleanup(
    library_client: TestClient, pdf_bytes: bytes
) -> None:
    item = collection(library_client)
    library_client.app.state.storage.max_pages = 1
    with pymupdf.open() as pdf:
        pdf.new_page()
        pdf.new_page()
        result = upload(library_client, item["id"], pdf.tobytes())
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "too_many_pages"
    # Removing the cross-reference terminator forces MuPDF to repair the document.
    repaired = pdf_bytes[: pdf_bytes.rfind(b"startxref")]
    result = upload(library_client, item["id"], repaired)
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "corrupted_pdf"
    assert not stored_files(library_client)


def test_validator_timeout_cleans_staged_upload(
    library_client: TestClient, pdf_bytes: bytes
) -> None:
    item = collection(library_client)
    with patch(
        "app.services.storage.subprocess.run",
        side_effect=subprocess.TimeoutExpired("validator", 15),
    ):
        result = upload(library_client, item["id"], pdf_bytes)
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "pdf_validation_timeout"
    assert not stored_files(library_client)
    assert library_client.get("/api/documents").json()["total"] == 0


def test_validator_crash_cleans_staged_upload(library_client: TestClient, pdf_bytes: bytes) -> None:
    item = collection(library_client)
    with patch(
        "app.services.storage.subprocess.run",
        return_value=subprocess.CompletedProcess([], 2, "", "private parser details"),
    ):
        result = upload(library_client, item["id"], pdf_bytes)
    assert result.status_code == 503 and "private parser details" not in result.text
    assert not stored_files(library_client)
