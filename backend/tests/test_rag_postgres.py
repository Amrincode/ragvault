from unittest.mock import MagicMock

import pytest
from test_library import collection
from test_processing import process
from test_vector_postgres import add_indexed
from test_vector_postgres import vector_client as vector_client

from app.services.llm import GeneratedAnswer, get_llm

pytestmark = pytest.mark.postgres


def test_chat_real_pgvector_scopes_pages_and_reprocessing(vector_client):
    client = vector_client
    finance = collection(client, "Finance")
    nature = collection(client, "Nature")
    first = add_indexed(client, finance["id"], ["Cover", "Revenue is 42 dollars."], "revenue.pdf")
    second = add_indexed(client, nature["id"], ["Forest trees store carbon."], "trees.pdf")
    llm = MagicMock()
    llm.generate.return_value = GeneratedAnswer(status="answered", answer="Revenue is 42 dollars.")
    client.app.dependency_overrides[get_llm] = lambda: llm
    response = client.post(
        "/api/chat",
        json={"question": "revenue", "collection_id": finance["id"], "document_id": first},
    )
    assert response.status_code == 200, response.text
    sources = response.json()["sources"]
    assert len(sources) == 1 and sources[0]["page_number"] == 2
    assert sources[0]["document_id"] == first and sources[0]["collection_id"] == finance["id"]
    sent = llm.generate.call_args.args[0][1]["content"]
    assert "42 dollars" in sent and "Forest trees" not in sent
    llm.reset_mock()
    mismatch = client.post(
        "/api/chat",
        json={"question": "revenue", "collection_id": nature["id"], "document_id": first},
    )
    assert mismatch.status_code == 422
    llm.generate.assert_not_called()
    no_support = client.post(
        "/api/chat", json={"question": "revenue", "document_id": second}
    ).json()
    assert no_support["status"] == "insufficient_evidence"
    llm.generate.assert_not_called()
    assert process(client, first).status_code == 200
    stale = client.post("/api/chat", json={"question": "revenue", "document_id": first}).json()
    assert stale["status"] == "insufficient_evidence" and stale["sources"] == []
    llm.generate.assert_not_called()
