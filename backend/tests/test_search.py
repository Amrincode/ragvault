from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import false, select
from sqlalchemy.dialects import postgresql
from test_indexing import embedding_client as embedding_client
from test_library import collection, upload
from test_library import library_client as library_client
from test_library import pdf_bytes as pdf_bytes

from app.models import Document
from app.schemas.search import SearchRequest
from app.services.embeddings import EmbeddingFailure
from app.services.search import search_statement


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"query": ""},
        {"query": "  "},
        {"query": "\x00"},
        {"query": "a" * 2001},
        {"query": "valid", "top_k": 0},
        {"query": "valid", "top_k": 21},
        {"query": "valid", "document_id": "bad"},
        {"query": "valid", "collection_id": "bad"},
    ],
)
def test_invalid_search_requests(library_client, embedding_client, body):
    assert library_client.post("/api/search", json=body).status_code == 422
    assert not embedding_client.calls


def test_search_sql_parameterizes_vectors_filters_and_compatibility():
    body = SearchRequest(
        query="untrusted query", collection_id=uuid4(), document_id=uuid4(), top_k=3
    )
    compiled = search_statement([1.0, 0.0, 0.0], "a" * 64, body, 3).compile(
        dialect=postgresql.dialect()
    )
    sql = str(compiled)
    assert "<=>" in sql
    assert "documents.collection_id =" in sql and "documents.id =" in sql
    assert "chunk_embeddings.fingerprint =" in sql and "documents.embedding_fingerprint =" in sql
    assert "documents.processing_status =" in sql and "documents.indexing_status =" in sql
    assert str(body.collection_id) not in sql and str(body.document_id) not in sql
    assert (
        body.collection_id in compiled.params.values()
        and body.document_id in compiled.params.values()
    )


def test_empty_search_returns_model_metadata_without_fake_results(library_client, embedding_client):
    with patch(
        "app.services.search.search_statement", return_value=select(Document.id).where(false())
    ) as statement:
        response = library_client.post(
            "/api/search", json={"query": "  where are the passages?  ", "top_k": 3}
        )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["items"] == [] and result["dimensions"] == 3 and result["top_k"] == 3
    assert result["model"] == "nomic-embed-text:latest"
    assert statement.call_args.args[2].query == "where are the passages?"


def test_search_rejects_conflicting_document_collection_scope(
    library_client, embedding_client, pdf_bytes
):
    first = collection(library_client, "One")
    second = collection(library_client, "Two")
    document = upload(library_client, first["id"], pdf_bytes).json()
    response = library_client.post(
        "/api/search",
        json={"query": "question", "collection_id": second["id"], "document_id": document["id"]},
    )
    assert response.status_code == 422 and not embedding_client.calls
    assert (
        library_client.post(
            "/api/search", json={"query": "q", "document_id": str(uuid4())}
        ).status_code
        == 404
    )
    assert (
        library_client.post(
            "/api/search", json={"query": "q", "collection_id": str(uuid4())}
        ).status_code
        == 404
    )


def test_unavailable_embeddings_and_concurrency_return_safe_errors(
    library_client, embedding_client
):
    with patch.object(
        embedding_client, "embed", side_effect=EmbeddingFailure("private source text")
    ):
        response = library_client.post("/api/search", json={"query": "question"})
    assert response.status_code == 503 and "private source text" not in response.text
    search = library_client.app.state.semantic_search
    search.slot.acquire()
    search.slot.acquire()
    try:
        assert library_client.post("/api/search", json={"query": "q"}).status_code == 409
    finally:
        search.slot.release()
        search.slot.release()
