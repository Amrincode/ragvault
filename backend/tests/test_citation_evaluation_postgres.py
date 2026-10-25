"""Known-answer disposable PDFs; PostgreSQL real, embeddings and chat mocked for CI."""

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from test_library import collection
from test_vector_postgres import add_indexed
from test_vector_postgres import vector_client as vector_client

from app.services.llm import GeneratedAnswer, get_llm
from app.services.rag_context import SYSTEM_INSTRUCTIONS

CASES = json.loads((Path(__file__).parent / "fixtures/citation-evaluation.json").read_text())
pytestmark = pytest.mark.postgres


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_known_answer_pdf_citation_pipeline(vector_client, case):
    client = vector_client
    group = collection(client, "Synthetic " + case["id"])
    document = add_indexed(client, group["id"], case["pages"], case["id"] + ".pdf")
    llm = MagicMock()

    def generate(messages):
        assert messages[0]["content"] == SYSTEM_INSTRUCTIONS
        supplied = json.loads(messages[1]["content"])["untrusted_sources"]
        assert supplied and all(
            s["document_id"] == document and s["collection_id"] == group["id"] for s in supplied
        )
        if case["kind"] == "unanswerable":
            return GeneratedAnswer(status="insufficient_evidence", claims=[])
        claims = []
        for source in supplied:
            text = source["excerpt"]
            if case["kind"] == "injection":
                text = text.split(".")[0] + "."
            claims.append(
                {
                    "text": text,
                    "citations": [
                        {
                            "citation_id": "C99"
                            if case["id"] == "citation_spoof"
                            else source["citation_id"],
                            "quote": text,
                        }
                    ],
                }
            )
        return GeneratedAnswer(
            status="partial" if case["kind"] == "partial" else "answered", claims=claims
        )

    llm.generate.side_effect = generate
    client.app.dependency_overrides[get_llm] = lambda: llm
    response = client.post(
        "/api/chat",
        json={
            "question": case["question"],
            "document_id": document,
            "collection_id": group["id"],
            "top_k": 5,
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["verification"]["factual_support"] == "not_established"
    if case["kind"] == "unanswerable":
        assert data["status"] == "insufficient_evidence"
    elif case["kind"] == "conflict" or case["id"] == "citation_spoof":
        assert data["status"] == "unreliable"
        assert not any(c["status"] == "potentially_supported" for c in data["claims"])
    else:
        assert data["status"] == ("partial" if case["kind"] == "partial" else "answered")
        assert all(c["status"] == "potentially_supported" for c in data["claims"])
        for claim in data["claims"]:
            for reference in claim["citations"]:
                assert (
                    reference["document_id"] == document
                    and reference["collection_id"] == group["id"]
                )
                assert reference["filename"] == case["id"] + ".pdf"
                assert " ".join(reference["excerpt"].split()) in " ".join(
                    case["pages"][reference["page_number"] - 1].split()
                )
        for fact in case["expected_facts"]:
            assert fact.casefold() in " ".join(data["answer"].casefold().split())
