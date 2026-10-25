"""Synthetic regressions for real-PDF failure patterns; no private source text."""

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from test_citations import answer, ref, source
from test_library import collection
from test_rag import hit
from test_vector_postgres import add_indexed
from test_vector_postgres import vector_client as vector_client

from app.schemas.chat import ChatRequest
from app.services.citations import verify_claims, wording_match
from app.services.evidence_focus import category_page_hits, requested_category
from app.services.llm import GeneratedAnswer, get_llm
from app.services.rag_context import assemble_context

CASES = json.loads((Path(__file__).parent / "fixtures/citation-reliability.json").read_text())
VALIDATION_CASES = json.loads(
    (Path(__file__).parent / "fixtures/citation-validation-cases.json").read_text()
)


@pytest.mark.parametrize("case", VALIDATION_CASES, ids=lambda case: case["id"])
def test_fixed_reliability_decisions(case):
    sources = [source(text, index=i) for i, text in enumerate(case["sources"], 1)]
    references = [ref(text, f"C{number}") for number, text in case["refs"]]
    claims = verify_claims(answer(case["text"], references), sources, case.get("question", ""))
    assert claims[0].status == case["expected"]


def test_added_final_period_is_formatting_not_a_new_numerical_claim():
    quote = "Participation in the bootcamp accounts for 10% of the final score"
    item = source(quote + " and provides practical training.")
    checked = verify_claims(answer(quote + ".", [ref(quote)]), [item])[0]
    assert checked.status == "potentially_supported" and checked.citations[0].excerpt == quote
    assert not wording_match("The score is 10%.", "The score is 100%")
    assert not wording_match("Students must attend.", "Students must not attend.")
    assert not wording_match("Starter teams: 2 to 5 members.", "Starter teams: 2 to 3 members.")


def test_valid_paraphrase_is_not_misrepresented_as_deterministically_verified():
    item = source("The report should include a problem statement and analysis of the situation.")
    checked = verify_claims(
        answer(
            "Students should describe the problem and analyse the situation.", [ref(item.excerpt)]
        ),
        [item],
    )[0]
    assert checked.status == "support_not_established"  # Semantic support remains unestablished.


@pytest.mark.parametrize("label", ["Starter", "Advanced"])
def test_numeric_claim_must_keep_its_category_even_when_quote_is_valid(label):
    quote = f"{label} category: Reports must not exceed 40 pages."
    item = source(quote)
    checked = verify_claims(answer("Reports must not exceed 40 pages.", [ref(quote)]), [item])[0]
    assert checked.status == "support_not_established"
    assert checked.issues == ["numeric_category_omitted"]


def test_wrong_category_and_presentation_time_are_not_report_limit_answers():
    starter = source("Starter category: Reports must not exceed 20 pages.")
    advanced = source("Advanced category: Presentations must not exceed 20 minutes.", index=2)
    question = "What is the maximum page count for the advanced category report?"
    generated = GeneratedAnswer(
        status="answered",
        claims=[
            {"text": s.excerpt, "citations": [ref(s.excerpt, s.citation_id)]}
            for s in (starter, advanced)
        ],
    )
    checked = verify_claims(generated, [starter, advanced], question)
    assert [c.status for c in checked] == ["relevance_not_established"] * 2
    assert checked[0].issues == ["requested_category_not_matched"]
    assert checked[1].issues == ["requested_page_limit_not_matched"]


def test_wrong_alias_is_never_rebound_to_a_matching_quote_in_another_source():
    first = source("Starter category: Reports must not exceed 20 pages.")
    second = source("Advanced category: Reports must not exceed 40\npages.", index=2)
    checked = verify_claims(
        answer(second.excerpt, [ref("Advanced category: Reports must not exceed 40 pages.")]),
        [first, second],
    )[0]
    assert checked.status == "invalid_citation" and checked.issues == ["quote_mismatch"]


def test_category_page_priority_is_stable_bounded_and_retains_filtering(settings):
    first = hit(excerpt="Starter category: Reports must not exceed 20 pages.")
    duration = hit(excerpt="Advanced category: Presentations must not exceed 20 minutes.")
    target = hit(excerpt="Advanced category: Reports must not exceed 40\npages.")
    outside = hit(excerpt=target.excerpt, document_id=first.document_id)
    question = "What is the maximum page count for the advanced category report?"
    hits = [first, duration, target]
    assert category_page_hits(question, hits) == [target, first, duration]
    assert category_page_hits("What should the report include?", hits) == hits
    assert category_page_hits("What is shown on page 2?", hits) == hits
    assert requested_category("Compare Starter and Advanced category reports") is None
    assert requested_category("Which category should I enter?") is None
    sources, messages = assemble_context(
        settings, ChatRequest(question=question, document_id=target.document_id), [outside, *hits]
    )
    assert sources and all(s.document_id == target.document_id for s in sources)
    assert sources[0].chunk_id == target.chunk_id
    assert sum(len(m["content"].encode()) for m in messages) <= 4096 - 512 - 128


def test_report_section_priority_avoids_spending_budget_on_general_aims(settings):
    aim = hit(excerpt="General aims: develop engineering and teamwork skills. " * 25)
    report = hit(
        excerpt="Advanced category: A project report is required. The report should include: "
        "a problem statement and background research. " * 5
    )
    question = "What should students include in their project report?"
    sources, _ = assemble_context(settings, ChatRequest(question=question), [aim, report])
    assert sources[0].chunk_id == report.chunk_id
    assert "problem statement" in sources[0].excerpt


def test_numeric_category_cannot_be_removed_by_quoting_a_sentence_fragment():
    item = source("Advanced category: Reports must not exceed 40 pages.")
    quote = "Reports must not exceed 40 pages."
    checked = verify_claims(answer(quote, [ref(quote)]), [item])[0]
    assert checked.status == "support_not_established"
    assert checked.issues == ["numeric_category_omitted"]


@pytest.mark.postgres
@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_disposable_pdf_realistic_citation_regressions(vector_client, case):
    client = vector_client
    group = collection(client, "Reliability " + case["id"])
    document = add_indexed(client, group["id"], case["pages"], case["id"] + ".pdf")
    model = MagicMock()

    def generate(messages):
        supplied = json.loads(messages[1]["content"])["untrusted_sources"]
        assert sum(len(m["content"].encode()) for m in messages) <= 4096 - 512 - 128
        claims = []
        for item in supplied:
            quote = item["excerpt"]
            if case["id"] == "report_contents":
                quote = "A problem statement and an analysis of the present situation"
                assert quote in " ".join(item["excerpt"].split())
            elif case["id"] == "participation":
                quote = "Participation in the bootcamp accounts for 10% of the final score"
            claims.append(
                {
                    "text": quote + ("." if not quote.endswith(".") else ""),
                    "citations": [ref(quote, item["citation_id"])],
                }
            )
        return GeneratedAnswer(status="answered", claims=claims)

    model.generate.side_effect = generate
    client.app.dependency_overrides[get_llm] = lambda: model
    response = client.post(
        "/api/chat",
        json={
            "question": case["question"],
            "document_id": document,
            "collection_id": group["id"],
            "top_k": 5,
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result["verification"]["factual_support"] == "not_established"
    assert any(c["status"] == "potentially_supported" for c in result["claims"])
    if case["id"] == "advanced_page_limit":
        assert "40" in result["answer"] and "20" not in result["answer"]
        assert result["sources"][0]["page_number"] == 3
        assert any(c["status"] == "relevance_not_established" for c in result["claims"])
    for claim in result["claims"]:
        for citation in claim["citations"]:
            assert citation["document_id"] == document and citation["collection_id"] == group["id"]
            assert " ".join(citation["excerpt"].split()) in " ".join(
                case["pages"][citation["page_number"] - 1].split()
            )
