from datetime import timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from test_library import library_client as library_client
from test_library import pdf_bytes as pdf_bytes
from test_processing import add_document, make_pdf, process

from app.models import ChunkEmbedding, Document
from app.models.library import utc_now
from app.services.embeddings import EmbeddingFailure, ModelIdentity, get_embeddings


class FakeEmbeddings:
    def __init__(self, settings):
        from app.services.embeddings import EmbeddingClient

        self.settings = settings
        self.model = ModelIdentity("nomic-embed-text:latest", "a" * 64)
        self.dimensions = 3
        self.calls = []
        self.fingerprint = lambda identity, dimensions: EmbeddingClient.fingerprint(
            self, identity, dimensions
        )

    def identity(self, **_):
        return self.model

    def embed(self, texts, identity, **kwargs):
        self.calls.append((texts, kwargs))
        if kwargs.get("dimensions") not in (None, self.dimensions):
            raise EmbeddingFailure
        return [[1.0] + [0.0] * (self.dimensions - 1) for _ in texts]


@pytest.fixture
def embedding_client(library_client):
    fake = FakeEmbeddings(library_client.app.state.settings)
    library_client.app.dependency_overrides[get_embeddings] = lambda: fake
    return fake


def index(client, identifier):
    return client.post(f"/api/documents/{identifier}/index")


def count(client):
    with Session(client.app.state.engine) as session:
        return session.scalar(select(func.count()).select_from(ChunkEmbedding))


def test_index_retry_reindex_model_change_and_cascade(library_client, embedding_client):
    identifier = add_document(library_client, make_pdf(["Page one text", "Page two text"]))
    assert index(library_client, identifier).status_code == 409
    assert process(library_client, identifier).status_code == 200
    result = index(library_client, identifier)
    assert result.status_code == 200, result.text
    assert result.json()["indexing_status"] == "indexed"
    assert result.json()["embedding_dimensions"] == 3
    assert result.json()["indexed_chunk_count"] == 2
    assert "indexing_token" not in result.json()
    assert count(library_client) == 2
    embedding_client.model = ModelIdentity("alternative:latest", "b" * 64)
    embedding_client.dimensions = 4
    result = index(library_client, identifier)
    assert result.status_code == 200 and result.json()["embedding_dimensions"] == 4
    assert result.json()["embedding_model"] == "alternative:latest" and count(library_client) == 2
    assert library_client.delete(f"/api/documents/{identifier}").status_code == 204
    assert count(library_client) == 0


def test_batch_handling_without_pdf_reextraction(library_client, embedding_client):
    identifier = add_document(library_client, make_pdf(["Page one", "Page two", "Page three"]))
    assert process(library_client, identifier).status_code == 200
    library_client.app.state.indexer.settings.embedding_batch_size = 2
    with patch(
        "app.services.processing.subprocess.run",
        side_effect=AssertionError("PDF must not be reopened"),
    ):
        result = index(library_client, identifier)
    assert result.status_code == 200, result.text
    assert [len(texts) for texts, _ in embedding_client.calls] == [2, 1]


def test_failed_reindex_invalidates_previous_vectors_and_allows_retry(
    library_client, embedding_client, pdf_bytes
):
    identifier = add_document(library_client, pdf_bytes)
    process(library_client, identifier)
    assert index(library_client, identifier).status_code == 200
    with patch.object(embedding_client, "embed", side_effect=EmbeddingFailure("private text")):
        failed = index(library_client, identifier)
    assert failed.status_code == 503 and "private text" not in failed.text
    assert count(library_client) == 0
    assert (
        library_client.get(f"/api/documents/{identifier}/indexing").json()["indexing_status"]
        == "failed"
    )
    assert index(library_client, identifier).status_code == 200


def test_reprocessing_removes_embeddings_and_resets_indexing(
    library_client, embedding_client, pdf_bytes
):
    identifier = add_document(library_client, pdf_bytes)
    process(library_client, identifier)
    index(library_client, identifier)
    result = process(library_client, identifier)
    assert result.json()["indexing_status"] == "not_indexed" and count(library_client) == 0


def test_model_digest_change_mid_index_is_not_committed(
    library_client, embedding_client, pdf_bytes
):
    identifier = add_document(library_client, pdf_bytes)
    process(library_client, identifier)
    with patch.object(
        embedding_client,
        "identity",
        side_effect=[embedding_client.model, ModelIdentity(embedding_client.model.name, "b" * 64)],
    ):
        assert index(library_client, identifier).status_code == 503
    assert count(library_client) == 0


def test_no_text_document_cannot_be_indexed(library_client, embedding_client):
    identifier = add_document(library_client, make_pdf([""]))
    process(library_client, identifier)
    assert index(library_client, identifier).status_code == 409
    assert not embedding_client.calls


def test_active_and_stale_index_claims(library_client, embedding_client, pdf_bytes):
    identifier = add_document(library_client, pdf_bytes)
    process(library_client, identifier)
    with Session(library_client.app.state.engine) as session:
        session.execute(
            update(Document)
            .where(Document.id == UUID(identifier))
            .values(
                indexing_status="indexing", indexing_token=uuid4(), indexing_started_at=utc_now()
            )
        )
        session.commit()
    assert index(library_client, identifier).status_code == 409
    assert library_client.delete(f"/api/documents/{identifier}").status_code == 409
    with Session(library_client.app.state.engine) as session:
        session.execute(
            update(Document)
            .where(Document.id == UUID(identifier))
            .values(indexing_started_at=utc_now() - timedelta(hours=1))
        )
        session.commit()
    assert index(library_client, identifier).status_code == 200


def test_reprocessing_during_indexing_discards_old_results(
    library_client, embedding_client, pdf_bytes
):
    identifier = add_document(library_client, pdf_bytes)
    process(library_client, identifier)
    actual = embedding_client.embed

    def change_source(*args, **kwargs):
        assert process(library_client, identifier).status_code == 200
        return actual(*args, **kwargs)

    with patch.object(embedding_client, "embed", side_effect=change_source):
        assert index(library_client, identifier).status_code == 409
    assert count(library_client) == 0


def test_vector_commit_failure_leaves_no_partial_rows(library_client, embedding_client, pdf_bytes):
    identifier = add_document(library_client, pdf_bytes)
    process(library_client, identifier)
    original = Session.commit
    calls = 0

    def fail_second(session):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OperationalError("commit", {}, Exception("private details"))
        return original(session)

    with patch.object(Session, "commit", fail_second):
        assert index(library_client, identifier).status_code == 503
    assert count(library_client) == 0


def test_index_resource_limits_and_recovery(library_client, embedding_client, pdf_bytes):
    identifier = add_document(library_client, pdf_bytes)
    process(library_client, identifier)
    library_client.app.state.indexer.settings.max_index_vector_values = 1
    assert index(library_client, identifier).status_code == 503
    assert count(library_client) == 0


def test_indexing_invalid_ids(library_client, embedding_client):
    assert index(library_client, "invalid").status_code == 422
    assert index(library_client, str(uuid4())).status_code == 404
    assert library_client.get(f"/api/documents/{uuid4()}/indexing").status_code == 404
