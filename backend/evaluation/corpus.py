"""Versioned synthetic corpus and deterministic, checked PDF generation."""

import hashlib
import json
import re
from pathlib import Path

import pymupdf

PATH = Path(__file__).with_name("corpus.json")


def normalized(value: str) -> str:
    return " ".join(value.split()).casefold()


def contains(text: str, span: str) -> bool:
    if not normalized(span):
        return False
    return bool(re.search(r"(?<!\w)" + re.escape(normalized(span)) + r"(?!\w)", normalized(text)))


def load() -> dict:
    corpus = json.loads(PATH.read_text(encoding="utf-8"))
    validate(corpus)
    return corpus


def validate(corpus: dict) -> None:
    assert corpus["schema_version"] == 1 and corpus["license"] == "CC0-1.0"
    documents = {d["id"]: d for d in corpus["documents"]}
    assert len(documents) == len(corpus["documents"]) <= 20
    assert all(re.fullmatch(r"[a-z][a-z0-9-]{0,63}", key) for key in documents)
    for fact in corpus["facts"].values():
        page = documents[fact["document"]]["pages"][fact["page"] - 1]
        assert fact["page"] >= 1 and contains(
            page["text"] + " " + page.get("footer", ""), fact["quote"]
        )
        assert fact["answer_spans"] and all(
            contains(fact["quote"], s) for s in fact["answer_spans"]
        )
    ids = [case["id"] for case in corpus["cases"]]
    assert len(ids) == len(set(ids)) <= 40
    for case in corpus["cases"]:
        assert re.fullmatch(r"[a-z][a-z0-9-]{0,63}", case["id"])
        assert case["expected_action"] in {"answer", "abstain", "clarify_or_qualify"}
        assert case["question"] and case["limitations"] and case["acceptable_answer_criteria"]
        allowed = allowed_documents(corpus, case)
        assert allowed
        assert len(case["prior_questions"]) <= 2
        assert [s["fact"] for s in case["gold_support"]] == case["expected_facts"]
        assert all(
            s["document"] in allowed
            and {k: v for k, v in s.items() if k != "fact"} == corpus["facts"][s["fact"]]
            for s in case["gold_support"]
        )
        assert not (set(case["expected_facts"]) & set(case["forbidden_facts"]))
        assert all(f in corpus["facts"] for f in case["forbidden_facts"])


def allowed_documents(corpus: dict, case: dict) -> set[str]:
    return {
        d["id"]
        for d in corpus["documents"]
        if (not case["document"] or case["document"] == d["id"])
        and (not case["collection"] or case["collection"] == d["collection"])
    }


def render(document: dict) -> bytes:
    with pymupdf.open() as pdf:
        for content in document["pages"]:
            page = pdf.new_page(width=595, height=842)
            if page.insert_textbox((40, 40, 555, 745), content["text"], fontsize=10) < 0:
                raise ValueError("Synthetic page overflow")
            if footer := content.get("footer"):
                page.insert_text((40, 790), footer, fontsize=10)
        data = pdf.tobytes(deflate=True, no_new_id=True)
    # Verify the actual PDF text, including footer/page placement, not just the JSON.
    with pymupdf.open(stream=data, filetype="pdf") as pdf:
        for number, content in enumerate(document["pages"]):
            actual = pdf[number].get_text()
            if not contains(actual, content["text"]) or (
                content.get("footer") and not contains(actual, content["footer"])
            ):
                raise ValueError("Synthetic PDF text differs from source specification")
    return data


def identity() -> dict:
    return {
        "version": load()["corpus_version"],
        "spec_sha256": hashlib.sha256(PATH.read_bytes()).hexdigest(),
        "renderer_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "pymupdf": pymupdf.VersionBind,
    }
