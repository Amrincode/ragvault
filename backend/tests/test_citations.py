from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session
from test_indexing import embedding_client as embedding_client
from test_library import collection, upload
from test_library import library_client as library_client
from test_processing import make_pdf, process

from app.schemas.chat import ChatRequest, ChatSource
from app.services.citations import CitationVerifier, SourceRecord, verify_claims, wording_match
from app.services.llm import GeneratedAnswer


def source(text="Starter teams: 2 to 3 members.", index=1, **changes):
    identifier = uuid4()
    return ChatSource(
        **{
            "source_id": "S-" + str(identifier),
            "citation_id": f"C{index}",
            "chunk_id": identifier,
            "document_id": uuid4(),
            "collection_id": uuid4(),
            "filename": "synthetic.pdf",
            "page_number": index,
            "excerpt": text,
            **changes,
        }
    )


def answer(text, citations):
    return GeneratedAnswer(status="answered", claims=[{"text": text, "citations": citations}])


def ref(quote="Starter teams: 2 to 3 members.", citation_id="C1"):
    return {"citation_id": citation_id, "quote": quote}


def test_valid_citation_binds_only_application_metadata():
    item = source()
    claim = verify_claims(answer(item.excerpt, [ref()]), [item])[0]
    assert claim.status == "potentially_supported"
    citation = claim.citations[0]
    assert citation.source_id == item.source_id and citation.chunk_id == item.chunk_id
    assert citation.document_id == item.document_id and citation.collection_id == item.collection_id
    assert citation.filename == item.filename and citation.page_number == 1
    assert (
        citation.excerpt == item.excerpt
        and citation.number == 1
        and citation.match_method == "exact"
    )


@pytest.mark.parametrize(
    "references,issue",
    [
        ([ref(citation_id="C99")], "unknown_citation"),
        ([ref(citation_id="javascript:alert(1)")], "unknown_citation"),
        ([ref(quote="")], "missing_quote"),
        ([ref(quote="Starter teams: 2 to 5 members.")], "quote_mismatch"),
        ([ref(), ref()], "duplicate_citation"),
        ([ref(), ref(citation_id="C99")], "unknown_citation"),
    ],
)
def test_invalid_citations_are_rejected_not_repaired(references, issue):
    claim = verify_claims(answer("Starter teams: 2 to 3 members.", references), [source()])[0]
    assert claim.status == "invalid_citation" and issue in claim.issues
    assert claim.citations == []


def test_uncited_and_paraphrased_claims_are_distinguished():
    assert verify_claims(answer("An uncited assertion", []), [source()])[0].status == "uncited"
    claim = verify_claims(answer("A team is recommended.", [ref()]), [source()])[0]
    assert claim.status == "support_not_established" and claim.issues == ["wording_not_matched"]


def test_wrong_category_numbers_are_withheld_even_if_all_numbers_exist_in_quote():
    item = source("Starter teams: 2 to 3 members. Advanced teams: 2 to 5 members.")
    claim = verify_claims(answer("Starter teams: 2 to 5 members.", [ref(item.excerpt)]), [item])[0]
    assert claim.status == "support_not_established"
    assert claim.issues == ["numeric_support_not_established"]


def test_numeric_boundaries_negation_and_unseen_tail_cannot_be_removed():
    assert not wording_match("2 members", "12 members")
    assert not wording_match("Teams must use encryption.", "Teams must not use encryption.")
    item = source("The submitted prefix only.")
    assert (
        verify_claims(answer("Unseen tail.", [ref("Unseen tail.")]), [item])[0].status
        == "invalid_citation"
    )


def test_multiple_sources_and_whitespace_matching_preserve_actual_excerpt():
    first = source("Starter teams:\n2 to 3 members.")
    second = source(index=2)
    claim = verify_claims(answer(second.excerpt, [ref(), ref(citation_id="C2")]), [first, second])[
        0
    ]
    assert claim.status == "potentially_supported" and len(claim.citations) == 2
    assert claim.citations[0].excerpt == first.excerpt
    assert claim.citations[0].match_method == "whitespace_normalized"


def test_conflicting_numbers_are_flagged_as_heuristic_not_truth():
    first = source()
    conflicting = source("Starter teams: 2 to 5 members.", index=2)
    claim = verify_claims(answer(first.excerpt, [ref()]), [first, conflicting])[0]
    assert claim.status == "potential_conflict"
    assert claim.issues == ["heuristic_numeric_conflict"]
    advanced = source("Advanced teams: 2 to 5 members.", index=2)
    assert (
        verify_claims(answer(first.excerpt, [ref()]), [first, advanced])[0].status
        == "potentially_supported"
    )


@pytest.fixture
def stored(library_client, embedding_client):
    group = collection(library_client)
    item = upload(library_client, group["id"], make_pdf(["Starter teams: 2 to 3 members."])).json()
    assert process(library_client, item["id"]).status_code == 200
    assert library_client.post(f"/api/documents/{item['id']}/index").status_code == 200
    chunk = library_client.get(f"/api/documents/{item['id']}/chunks").json()["items"][0]
    citation = ChatSource(
        source_id="S-" + chunk["id"],
        citation_id="C1",
        document_id=item["id"],
        collection_id=group["id"],
        filename=item["filename"],
        page_number=chunk["page_number"],
        chunk_id=chunk["id"],
        excerpt=chunk["text"],
    )
    return library_client, citation


def test_real_stored_chunk_is_checked_with_model_and_scope(stored):
    client, item = stored
    with Session(client.app.state.engine) as session:
        CitationVerifier().check_sources(
            session,
            [item],
            ChatRequest(question="q", document_id=item.document_id),
            "nomic-embed-text:latest",
            3,
        )
        assert not session.in_transaction()


@pytest.mark.parametrize(
    "field,value",
    [
        ("document_id", uuid4()),
        ("collection_id", uuid4()),
        ("chunk_id", uuid4()),
        ("page_number", 99),
        ("filename", "invented.pdf"),
        ("excerpt", "Not in the database"),
        ("source_id", "S-invented"),
        ("citation_id", "C99"),
    ],
)
def test_stored_metadata_spoofing_is_rejected(stored, field, value):
    client, item = stored
    with Session(client.app.state.engine) as session, pytest.raises(HTTPException) as failure:
        CitationVerifier().check_sources(
            session,
            [item.model_copy(update={field: value})],
            ChatRequest(question="q"),
            "nomic-embed-text:latest",
            3,
        )
    assert failure.value.status_code == 409 and failure.value.detail["code"] == "evidence_changed"


def test_filter_and_index_eligibility_are_mandatory():
    item = source()
    record = SourceRecord(
        item.document_id,
        item.filename,
        item.collection_id,
        1,
        item.chunk_id,
        item.excerpt,
        "nomic-embed-text:latest",
        3,
        True,
    )

    class SessionStub:
        def rollback(self):
            pass

    for body, stored_record in [
        (ChatRequest(question="q", collection_id=uuid4()), record),
        (ChatRequest(question="q", document_id=uuid4()), record),
        (ChatRequest(question="q"), replace(record, eligible=False)),
        (ChatRequest(question="q"), replace(record, dimensions=4)),
    ]:
        with pytest.raises(HTTPException):
            CitationVerifier(
                lambda *_, record=stored_record: {item.chunk_id: record}
            ).check_sources(SessionStub(), [item], body, "nomic-embed-text:latest", 3)
