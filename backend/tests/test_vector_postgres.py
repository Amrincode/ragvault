"""Explicit PostgreSQL integration tests, all embeddings mocked and schemas disposable."""

import os
import re
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from test_indexing import FakeEmbeddings
from test_library import collection, upload
from test_processing import make_pdf, process

from app.core.config import Settings
from app.db.base import Base
from app.db.session import build_engine
from app.main import create_app
from app.services.embeddings import ModelIdentity, get_embeddings

pytestmark = pytest.mark.postgres


class TopicEmbeddings(FakeEmbeddings):
    def embed(self, texts, identity, **kwargs):
        vectors = [
            [1.0, 0.0, 0.0]
            if "revenue" in t.lower() or "sales" in t.lower()
            else [0.0, 1.0, 0.0]
            if "tree" in t.lower() or "forest" in t.lower()
            else [0.0, 0.0, 1.0]
            for t in texts
        ]
        return [v + [0.0] * (self.dimensions - 3) for v in vectors]


@pytest.fixture
def vector_client(tmp_path):
    if os.environ.get("RAGVAULT_TEST_POSTGRES") != "1":
        pytest.skip("Set RAGVAULT_TEST_POSTGRES=1 for isolated pgvector integration tests")
    settings = Settings().model_copy(update={"app_env": "test", "upload_dir": tmp_path / "uploads"})
    admin = build_engine(settings)
    schema = "ragvault_test_" + uuid4().hex
    assert re.fullmatch(r"ragvault_test_[0-9a-f]{32}", schema)
    with admin.begin() as connection:
        assert connection.execute(
            text("SELECT extversion FROM pg_extension WHERE extname='vector'")
        ).scalar_one()
        connection.execute(text("CREATE SCHEMA " + schema))
    engine = create_engine(
        settings.database_url,
        connect_args={
            "options": f"-c search_path={schema},public -c statement_timeout=10000",
            "connect_timeout": settings.database_timeout_seconds,
        },
        execution_options={"schema_translate_map": {None: schema}},
    )
    try:
        Base.metadata.create_all(engine)
        fake = TopicEmbeddings(settings)
        app = create_app(settings)
        app.dependency_overrides[get_embeddings] = lambda: fake
        with patch("app.main.build_engine", return_value=engine), TestClient(app) as client:
            client.embedding_fake = fake
            yield client
    finally:
        engine.dispose()
        # Only the schema created above is removed; public/user tables are never touched.
        with admin.begin() as connection:
            connection.execute(text("DROP SCHEMA " + schema + " CASCADE"))
        admin.dispose()


def add_indexed(client, collection_id, pages, filename):
    response = upload(client, collection_id, make_pdf(pages), filename=filename)
    assert response.status_code == 201, response.text
    identifier = response.json()["id"]
    assert process(client, identifier).status_code == 200
    response = client.post(f"/api/documents/{identifier}/index")
    assert response.status_code == 200, response.text
    return identifier


def test_exact_pgvector_ranking_filters_pages_and_reindex(vector_client):
    client = vector_client
    finance = collection(client, "Finance")
    nature = collection(client, "Nature")
    first = add_indexed(
        client,
        finance["id"],
        ["Unrelated cover", "Revenue grew from subscription sales."],
        "finance.pdf",
    )
    second = add_indexed(client, nature["id"], ["Trees grow in the forest."], "nature.pdf")
    result = client.post("/api/search", json={"query": "revenue", "top_k": 1}).json()
    hit = result["items"][0]
    assert (
        hit["document_id"] == first and hit["page_number"] == 2 and hit["filename"] == "finance.pdf"
    )
    assert hit["similarity"] == pytest.approx(1.0) and hit["distance"] == pytest.approx(0.0)
    scoped = client.post(
        "/api/search", json={"query": "revenue", "collection_id": nature["id"]}
    ).json()
    assert scoped["items"] and all(
        h["document_id"] == second and h["collection_id"] == nature["id"] for h in scoped["items"]
    )
    scoped = client.post("/api/search", json={"query": "tree", "document_id": first}).json()
    assert all(h["document_id"] == first for h in scoped["items"])
    assert client.post(f"/api/documents/{first}/index").status_code == 200
    with client.app.state.engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM chunk_embeddings")).scalar_one() == 3


def test_model_changes_and_reprocessing_exclude_stale_vectors(vector_client):
    client = vector_client
    group = collection(client, "Sources")
    identifier = add_indexed(client, group["id"], ["Revenue from sales."], "source.pdf")
    client.embedding_fake.model = ModelIdentity("nomic-embed-text:latest", "b" * 64)
    result = client.post("/api/search", json={"query": "revenue"}).json()
    assert result["items"] == [] and result["incompatible_documents"] == 1
    assert client.post(f"/api/documents/{identifier}/index").status_code == 200
    assert client.post("/api/search", json={"query": "revenue"}).json()["items"]
    assert process(client, identifier).status_code == 200
    assert client.post("/api/search", json={"query": "revenue"}).json()["items"] == []
    with client.app.state.engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM chunk_embeddings")).scalar_one() == 0


def test_pgvector_delete_cleanup_and_empty_results(vector_client):
    client = vector_client
    group = collection(client, "Cleanup")
    identifier = add_indexed(client, group["id"], ["Revenue source."], "source.pdf")
    assert client.delete(f"/api/documents/{identifier}").status_code == 204
    with client.app.state.engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM chunk_embeddings")).scalar_one() == 0
    assert client.post("/api/search", json={"query": "revenue"}).json()["items"] == []


def test_different_model_dimensions_coexist_without_cross_model_results(vector_client):
    client = vector_client
    group = collection(client, "Models")
    first = add_indexed(client, group["id"], ["Revenue source."], "first.pdf")
    original = client.embedding_fake.model
    client.embedding_fake.model = ModelIdentity("alternative:latest", "b" * 64)
    client.embedding_fake.dimensions = 4
    second = add_indexed(client, group["id"], ["Tree source."], "second.pdf")
    result = client.post("/api/search", json={"query": "tree"}).json()
    assert result["items"] and all(h["document_id"] == second for h in result["items"])
    assert result["dimensions"] == 4 and result["incompatible_documents"] == 1
    client.embedding_fake.model = original
    client.embedding_fake.dimensions = 3
    result = client.post("/api/search", json={"query": "revenue"}).json()
    assert result["items"] and all(h["document_id"] == first for h in result["items"])
    assert result["incompatible_documents"] == 1
