"""Boundaries exercised only against temporary SQLite, files and synthetic inputs."""

import io
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException, Request, UploadFile
from sqlalchemy.orm import Session
from test_library import collection, upload
from test_library import library_client as library_client
from test_library import pdf_bytes as pdf_bytes

from app.api.library import serve_document
from app.services.storage import DocumentStorage


def test_search_rejects_invalid_unicode_without_calling_embedding(library_client):
    with patch.object(library_client.app.state.semantic_search, "run") as run:
        response = library_client.post(
            "/api/search",
            content='{"query":"private-canary\\ud800"}',
            headers={"Content-Type": "application/json"},
        )
    assert response.status_code == 422
    assert "private-canary" not in response.text
    run.assert_not_called()


@pytest.mark.parametrize(
    "origin", ["null", "https://untrusted.example", "http://localhost:5173.evil", "not-an-origin"]
)
def test_untrusted_origins_cannot_mutate_library(library_client, origin):
    response = library_client.post(
        "/api/collections", json={"name": "Denied"}, headers={"Origin": origin}
    )
    assert response.status_code == 403
    assert "access-control-allow-origin" not in response.headers
    assert library_client.get("/api/collections").json() == []


@pytest.mark.parametrize("origin", [None, "http://localhost:5173", "http://localhost:8000"])
def test_native_or_allowed_origin_is_not_authentication(library_client, origin):
    response = library_client.post(
        "/api/collections",
        json={"name": "Allowed"},
        headers={"Origin": origin} if origin else {},
    )
    assert response.status_code == 201


@pytest.mark.parametrize("host", ["evil.example", "localhost.evil", "192.0.2.1"])
def test_rebinding_host_is_rejected(library_client, host):
    assert library_client.get("/api/collections", headers={"Host": host}).status_code == 400


def test_preflight_is_narrow_and_unsupported_method_does_not_mutate(library_client):
    for origin, status in [("http://localhost:5173", 200), ("https://untrusted.example", 400)]:
        response = library_client.options(
            "/api/collections",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response.status_code == status
        assert ("access-control-allow-origin" in response.headers) == (status == 200)
        assert "access-control-allow-credentials" not in response.headers
    assert library_client.put("/api/collections", json={"name": "No"}).status_code == 405
    assert library_client.get("/api/collections").json() == []


def test_search_limit_and_validation_do_not_call_search(library_client):
    with patch.object(library_client.app.state.semantic_search, "run") as run:
        response = library_client.post(
            "/api/search", json={"query": "safe", "ignored": "x" * 16384}
        )
        assert response.status_code == 413
        for payload in [
            {"query": "private-canary\x00"},
            {"query": "safe", "document_id": "private-canary"},
        ]:
            response = library_client.post("/api/search", json=payload)
            assert response.status_code == 422 and "private-canary" not in response.text
        run.assert_not_called()


def test_storage_paths_and_external_cleanup_are_rejected(settings, tmp_path):
    storage = DocumentStorage(settings)
    sentinel = tmp_path / "outside.pdf"
    sentinel.write_bytes(b"preserve")
    storage.cleanup(sentinel)
    assert sentinel.read_bytes() == b"preserve"
    for key in ["../outside.pdf", str(sentinel), "C:\\synthetic\\outside.pdf", "a.pdf"]:
        with pytest.raises(HTTPException):
            storage.open_pdf(key)


def test_validator_slot_is_released_after_failure(settings):
    storage = DocumentStorage(settings)
    path = storage.temporary / (uuid4().hex + ".tmp")
    path.write_bytes(b"%PDF-synthetic")
    with patch("app.services.storage.subprocess.run", side_effect=OSError("private-canary")):
        with pytest.raises(HTTPException) as error:
            storage.validate_pdf(path)
        assert error.value.status_code == 503
        assert "private-canary" not in str(error.value.detail)
    with patch(
        "app.services.storage.subprocess.run",
        return_value=SimpleNamespace(returncode=0, stdout='{"code":"ok"}'),
    ):
        storage.validate_pdf(path)


@pytest.mark.skipif(os.name == "nt", reason="POSIX modes do not establish Windows ACL privacy")
def test_new_storage_is_private_on_posix(settings):
    storage = DocumentStorage(settings)
    with patch.object(storage, "validate_pdf"):
        staged = storage.stage(UploadFile(io.BytesIO(b"%PDF-synthetic"), filename="safe.pdf"))
    assert all(
        directory.stat().st_mode & 0o777 == 0o700
        for directory in (storage.root, storage.temporary, storage.trash)
    )
    assert staged.path.stat().st_mode & 0o777 == 0o600


def test_pdf_with_html_suffix_is_served_only_as_untrusted_original(library_client, pdf_bytes):
    group = collection(library_client)
    payload = pdf_bytes + b'\n<script>throw "synthetic"</script>'
    result = upload(library_client, group["id"], payload, "C:\\fakepath\\safe.pdf")
    # Structural PDF validation is deliberately not a malware/polyglot detector.
    assert result.status_code == 201
    document = result.json()
    assert document["filename"] == "safe.pdf"
    response = library_client.get(f"/api/documents/{document['id']}/file")
    assert response.content == payload
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in response.headers["content-security-policy"]


def test_invalid_id_and_storage_exception_are_redacted(library_client, pdf_bytes, capsys):
    assert library_client.get("/api/documents/private-canary").status_code == 422
    assert library_client.get(f"/api/documents/{uuid4()}").status_code == 404
    group = collection(library_client)
    document = upload(library_client, group["id"], pdf_bytes).json()
    capsys.readouterr()
    with patch.object(
        library_client.app.state.storage, "open_pdf", side_effect=PermissionError("private-canary")
    ):
        response = library_client.get(f"/api/documents/{document['id']}/file")
    assert response.status_code == 503
    assert "private-canary" not in response.text + capsys.readouterr().out
    assert library_client.get(f"/api/documents/{document['id']}/file").content == pdf_bytes


@pytest.mark.parametrize("chunked", [False, True])
def test_nonchat_body_is_bounded_before_parsing(library_client, chunked):
    payload = json.dumps({"name": "Synthetic", "ignored": "x" * 16384}).encode()
    response = library_client.post(
        "/api/collections",
        content=iter([payload[:500], payload[500:]]) if chunked else payload,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert library_client.get("/api/collections").json() == []


@pytest.mark.parametrize("value", ["private-canary\x00", "private-canary\ud800"])
def test_library_validation_does_not_reflect_private_inputs(library_client, value):
    # JSON escapes let the request reach the server even for invalid Unicode.
    response = library_client.post(
        "/api/collections",
        content=json.dumps({"name": value}),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert "private-canary" not in response.text
    assert isinstance(response.json()["detail"], dict)


@contextmanager
def redirected_directory(directory, outside):
    """Own both paths; remove only the link, never recursively traverse it."""
    directory.rmdir()
    if os.name == "nt":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(directory), str(outside)],
            capture_output=True,
        )
        assert result.returncode == 0
    else:
        directory.symlink_to(outside, target_is_directory=True)
    try:
        yield
    finally:
        directory.rmdir() if os.name == "nt" else directory.unlink()
        directory.mkdir()


def test_runtime_staging_redirect_is_rejected(settings, tmp_path):
    storage = DocumentStorage(settings)
    outside = tmp_path / "outside"
    outside.mkdir()
    with redirected_directory(storage.temporary, outside):
        with patch.object(storage, "validate_pdf"):
            with pytest.raises(OSError):
                storage.stage(UploadFile(io.BytesIO(b"%PDF-synthetic"), filename="safe.pdf"))
        assert list(outside.iterdir()) == []


def test_runtime_trash_redirect_preserves_original(settings, tmp_path):
    storage = DocumentStorage(settings)
    key = uuid4().hex + ".pdf"
    source = storage.path_for(key)
    source.write_bytes(b"synthetic")
    outside = tmp_path / "outside"
    outside.mkdir()
    with redirected_directory(storage.trash, outside):
        with pytest.raises(OSError):
            storage.quarantine(key)
        assert source.read_bytes() == b"synthetic"
        assert list(outside.iterdir()) == []


def test_cleanup_refuses_redirected_parent(settings, tmp_path):
    storage = DocumentStorage(settings)
    outside = tmp_path / "outside"
    outside.mkdir()
    name = uuid4().hex + ".tmp"
    sentinel = outside / name
    sentinel.write_bytes(b"preserve")
    with redirected_directory(storage.temporary, outside):
        storage.cleanup(storage.temporary / name)
        assert sentinel.read_bytes() == b"preserve"


def test_upload_validation_admission_and_release(settings):
    storage = DocumentStorage(settings)
    path = storage.temporary / (uuid4().hex + ".tmp")
    path.write_bytes(b"%PDF-synthetic")
    entered, release = Event(), Event()

    def child(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return SimpleNamespace(returncode=0, stdout='{"code":"ok"}')

    with patch("app.services.storage.subprocess.run", side_effect=child) as run:
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(storage.validate_pdf, path)
            assert entered.wait(5)
            try:
                # Fail immediately if a second subprocess is admitted (no timeout wait).
                run.side_effect = AssertionError("Second parser admitted")
                with pytest.raises(HTTPException) as error:
                    storage.validate_pdf(path)
                assert error.value.status_code == 409
                assert error.value.detail["code"] == "validator_busy"
            finally:
                release.set()
                first.result(timeout=5)
        run.side_effect = None
        run.return_value = SimpleNamespace(returncode=0, stdout='{"code":"ok"}')
        storage.validate_pdf(path)


@pytest.mark.parametrize("failure", ["stat", "headers"])
def test_pdf_handle_closed_if_response_setup_fails(library_client, pdf_bytes, failure):
    group = collection(library_client)
    document = upload(library_client, group["id"], pdf_bytes).json()
    storage = library_client.app.state.storage
    source = storage.open_pdf(document["id"].replace("-", "") + ".pdf")
    target = "os.fstat" if failure == "stat" else "_PDFStreamingResponse"
    try:
        with (
            Session(library_client.app.state.engine) as session,
            patch.object(storage, "open_pdf", return_value=source),
            patch(f"app.api.library.{target}", side_effect=OSError("Synthetic setup failure")),
            pytest.raises(OSError),
        ):
            serve_document(
                UUID(document["id"]),
                session,
                storage,
                Request({"type": "http", "app": library_client.app}),
            )
        assert source.closed
    finally:
        source.close()
