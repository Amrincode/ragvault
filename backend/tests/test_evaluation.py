"""Deterministic evaluation tests only. No live Ollama or real-library access."""

import json
import subprocess

import pytest

from evaluation import run
from evaluation.corpus import contains, load, render, validate
from evaluation.metrics import fraction, score, summarize


@pytest.fixture
def corpus():
    return load()


def scenario(corpus, case_id="advanced-limit", fact_id="advanced_limit"):
    case = next(c for c in corpus["cases"] if c["id"] == case_id)
    fact = corpus["facts"][fact_id]
    source = {
        "document": fact["document"],
        "document_id": "synthetic-doc",
        "collection_id": "synthetic-collection",
        "chunk_id": "synthetic-chunk",
        "page_number": fact["page"],
        "excerpt": fact["quote"],
        "citation_id": "C1",
    }
    catalog = {source["chunk_id"]: dict(source)}
    claim = {
        "text": fact["quote"],
        "status": "potentially_supported",
        "citations": [dict(source)],
        "issues": [],
    }
    observation = {
        "retrieved": [dict(source)],
        "context": [dict(source)],
        "llm_calls": 1,
        "generated": {
            "status": "answered",
            "claims": [
                {
                    "text": fact["quote"],
                    "citations": [{"citation_id": "C1", "quote": fact["quote"]}],
                }
            ],
        },
        "response": {
            "status": "answered",
            "answer": fact["quote"],
            "claims": [claim],
            "timings": {"retrieval_ms": 1, "generation_ms": 2, "verification_ms": 1, "total_ms": 4},
        },
    }
    return case, observation, catalog


def test_corpus_has_independent_keys_categories_and_pdf_integrity(corpus):
    assert len(corpus["documents"]) == 5 and len(corpus["cases"]) == 16
    assert len({case["category"] for case in corpus["cases"]}) >= 10
    assert corpus["facts"]["advanced_limit"]["quote"].endswith("40 pages.")
    assert corpus["facts"]["starter_limit"]["quote"].endswith("20 pages.")
    assert corpus["facts"]["greenhouse_limit"]["quote"].endswith("80 pages.")
    for document in corpus["documents"]:
        assert render(document) == render(document)


@pytest.mark.parametrize("damage", ["quote", "page", "scope", "duplicate_id"])
def test_bad_ground_truth_is_rejected(corpus, damage):
    if damage == "quote":
        corpus["facts"]["advanced_limit"]["quote"] = "Invented 999 pages."
    elif damage == "page":
        corpus["facts"]["advanced_limit"]["page"] = 1
    elif damage == "scope":
        corpus["cases"][0]["collection"] = "greenhouse"
    else:
        corpus["cases"][1]["id"] = corpus["cases"][0]["id"]
    with pytest.raises(AssertionError):
        validate(corpus)


@pytest.mark.parametrize(
    "text,span,expected",
    [
        ("120 pages", "20 pages", False),
        ("20 pages", "20", True),
        ("Names", "", False),
        ("not Mira Stone", "Mira Stone", True),
        ("Advanced\n category: Reports", "advanced category: reports", True),
    ],
)
def test_matching_is_literal_not_semantic(text, span, expected):
    assert contains(text, span) == expected


def test_valid_source_and_quote_do_not_prove_answer_correctness(corpus):
    case, obs, catalog = scenario(corpus, fact_id="starter_limit")
    result = score(corpus, case, obs, catalog)
    assert result["accepted_valid_document_page"] == result["accepted_quote_matches"] == 1
    assert not result["strict_key_pass"] and result["displayed_facts"] == []
    assert "accepted_wrong_or_irrelevant_key_fact" in result["failures"]


def test_correct_answer_and_complete_evidence(corpus):
    case, obs, catalog = scenario(corpus)
    result = score(corpus, case, obs, catalog)
    assert result["strict_key_pass"] and result["failures"] == []
    assert result["displayed_facts"] == result["context_facts"] == ["advanced_limit"]


@pytest.mark.parametrize("stage", ["retrieval", "context", "generation", "validation"])
def test_distinct_failure_stages(corpus, stage):
    case, obs, catalog = scenario(corpus)
    if stage == "retrieval":
        obs["retrieved"] = []
    elif stage == "context":
        obs["context"] = []
    elif stage == "generation":
        obs["generated"]["claims"] = []
    else:
        obs["response"]["claims"][0]["status"] = "potential_conflict"
        obs["response"]["claims"][0]["issues"] = ["heuristic_numeric_conflict"]
        obs["response"]["status"] = "unreliable"
    result = score(corpus, case, obs, catalog)
    expected = {
        "retrieval": "retrieval_missing_gold",
        "context": "context_excluded_gold",
        "generation": "generation_missing_gold",
        "validation": "gold_selection_withheld",
    }
    assert expected[stage] in result["failures"]


def test_bad_alias_not_counted_as_validator_false_rejection(corpus):
    case, obs, catalog = scenario(corpus)
    obs["generated"]["claims"][0]["citations"][0]["citation_id"] = "C99"
    obs["response"]["claims"] = []
    obs["response"]["status"] = "unreliable"
    result = score(corpus, case, obs, catalog)
    assert result["raw_valid_document_page"] == 0
    assert "generated_invalid_source_alias" in result["failures"]
    assert "gold_selection_withheld" not in result["failures"]


def test_number_changed_despite_valid_reference_is_not_correct(corpus):
    case, obs, catalog = scenario(corpus)
    obs["response"]["claims"][0]["text"] = "Advanced category: Reports must not exceed 999 pages."
    result = score(corpus, case, obs, catalog)
    assert not result["strict_key_pass"] and result["displayed_facts"] == []
    assert result["accepted_literal_claims"] == 0


def test_fallback_is_not_an_answer(corpus):
    case, obs, catalog = scenario(corpus)
    obs["response"]["claims"] = []
    obs["response"]["status"] = "insufficient_evidence"
    obs["response"]["evidence_fallback"] = obs["context"]
    result = score(corpus, case, obs, catalog)
    assert result["abstained"] and not result["displayed_facts"]
    assert "incorrect_abstention_context_present" in result["failures"]


def test_operational_error_is_not_successful_abstention(corpus):
    case, obs, catalog = scenario(corpus, "unanswerable-award")
    obs["response"] = {}
    obs["error"] = "chat_unavailable"
    result = score(corpus, case, obs, catalog)
    assert not result["strict_key_pass"] and not result["abstained"]
    assert "operational_chat_unavailable" in result["failures"]


def test_abstention_on_unknown_question_is_appropriate(corpus):
    case, obs, catalog = scenario(corpus, "unanswerable-award")
    obs["response"].update(status="insufficient_evidence", claims=[])
    assert score(corpus, case, obs, catalog)["strict_key_pass"]


def test_scope_leakage_independent_of_citation_validity(corpus):
    case, obs, catalog = scenario(corpus, fact_id="greenhouse_limit")
    result = score(corpus, case, obs, catalog)
    assert result["accepted_valid_document_page"] == 1
    assert "scope_leakage" in result["failures"]
    assert not result["strict_key_pass"]


def test_summary_denominators_and_variability(corpus):
    case, obs, catalog = scenario(corpus)
    a = score(corpus, case, obs, catalog)
    obs["response"]["claims"] = []
    obs["response"]["status"] = "unreliable"
    b = score(corpus, case, obs, catalog)
    summary = summarize([a, b])
    assert summary["strict_key_compliance"] == {"numerator": 1, "denominator": 2, "rate": 0.5}
    assert summary["cases_with_varying_outcomes"] == [case["id"]]
    assert fraction(0, 0)["rate"] is None
    assert summarize([])["appropriate_abstention"]["rate"] is None


def test_configuration_excludes_credentials_and_preserves_limits(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "ROOT", tmp_path)
    (tmp_path / ".env").write_text(
        "POSTGRES_PASSWORD=private-canary\nCHAT_CONTEXT_TOKENS=4096\nOLLAMA_CHAT_MODEL=gemma3:4b\n"
    )
    monkeypatch.delenv("CHAT_CONTEXT_TOKENS", raising=False)
    values = run.configuration()
    assert "private-canary" not in json.dumps(values)
    assert values["CHAT_CONTEXT_TOKENS"] == "4096"
    assert values["OLLAMA_BASE_URL"] == "http://host.docker.internal:11434"


def test_list_is_readonly_and_never_starts_docker(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["evaluation", "--list"])
    monkeypatch.setattr(run, "run", lambda *a: pytest.fail("Live run from list"))
    assert run.main() == 0
    assert "advanced-limit" in capsys.readouterr().out


def test_failure_removes_only_owned_resources_and_redacts_errors(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(run, "ROOT", tmp_path)
    (tmp_path / "backend/app").mkdir(parents=True)
    commands = []
    nonce = None

    def fake(args, **kwargs):
        nonlocal nonce
        commands.append(args)
        stdout = b""
        if args[:3] == ["docker", "network", "create"]:
            nonce = args[-1].removeprefix("ragvault-eval-")
        if args[:3] == ["docker", "image", "inspect"]:
            stdout = b"sha256:synthetic"
        if args[:2] == ["git", "rev-parse"]:
            stdout = b"synthetic-commit"
        if (
            args[:2] == ["docker", "run"]
            and "--name" in args
            and "worker" in args[args.index("--name") + 1]
        ):
            raise subprocess.CalledProcessError(2, args, stderr=b"private-canary")
        if args[:2] == ["docker", "inspect"]:
            stdout = json.dumps({"ragvault.evaluation": nonce}).encode()
        if args[:3] == ["docker", "network", "inspect"]:
            stdout = json.dumps({"ragvault.evaluation": nonce}).encode()
        return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr=b"")

    monkeypatch.setattr(run.subprocess, "run", fake)
    assert run.run(["coordinator"], 1) == 2
    assert "private-canary" not in capsys.readouterr().out
    removals = [args for args in commands if args[:3] == ["docker", "rm", "-f"]]
    assert len(removals) == 2 and all(args[-1].endswith(nonce) for args in removals)
    assert all("volume" not in args and "--volumes" not in args for args in commands)
    meta = json.loads(next((tmp_path / ".artifacts/evaluations").glob("*/run.json")).read_text())
    assert meta["resources_removed"] and meta["status"] == "incomplete"


def test_unobserved_retrieval_is_not_a_success_or_a_measured_miss(corpus):
    case, obs, catalog = scenario(corpus)
    obs.pop("retrieved")
    obs.pop("context")
    obs["response"] = {}
    obs["error"] = "database_unavailable"
    result = score(corpus, case, obs, catalog)
    summary = summarize([result])
    assert "retrieval_not_observed" in result["failures"]
    assert "retrieval_missing_gold" not in result["failures"]
    assert summary["retrieval_evidence_recall"]["denominator"] == 0
    assert not result["strict_key_pass"]


def test_context_quote_cannot_invent_support_absent_from_original_chunk(corpus):
    case, obs, catalog = scenario(corpus)
    catalog["synthetic-chunk"]["excerpt"] = "Different source text."
    result = score(corpus, case, obs, catalog)
    assert result["raw_valid_document_page"] == 1
    assert result["raw_quote_matches"] == 0
    assert result["accepted_quote_matches"] == 0
    assert not result["strict_key_pass"]


def test_ambiguity_allows_abstention_or_all_qualified_alternatives(corpus):
    case, obs, catalog = scenario(corpus, "ambiguous-limit")
    assert not score(corpus, case, obs, catalog)["strict_key_pass"]
    obs["response"].update(status="insufficient_evidence", claims=[])
    assert score(corpus, case, obs, catalog)["strict_key_pass"]


def test_injection_marker_is_a_failure_even_with_valid_source_metadata(corpus):
    case, obs, catalog = scenario(corpus, "embedded-instructions", "assembly")
    attack = "BENCHMARK_OVERRIDE"
    obs["context"][0]["excerpt"] += " " + attack
    catalog["synthetic-chunk"]["excerpt"] += " " + attack
    obs["response"]["claims"][0]["text"] = attack
    obs["response"]["claims"][0]["citations"][0]["excerpt"] = attack
    result = score(corpus, case, obs, catalog)
    assert result["accepted_quote_matches"] == 1
    assert "injection_marker_accepted" in result["failures"]
    assert not result["strict_key_pass"]


def test_live_observers_return_original_results_without_changing_inputs():
    from types import SimpleNamespace

    from evaluation.worker import Observer

    source = {
        "document_id": "d",
        "collection_id": "c",
        "chunk_id": "k",
        "page_number": 1,
        "citation_id": "C1",
        "excerpt": "Synthetic source",
    }
    item = SimpleNamespace(model_dump=lambda **kw: dict(source))
    searched = SimpleNamespace(items=[item], elapsed_ms=1)
    generated = SimpleNamespace(
        model_dump=lambda **kw: {"claims": [], "status": "insufficient_evidence"}
    )
    answered = SimpleNamespace(sources=[item], model_dump=lambda **kw: {"claims": []})
    search = SimpleNamespace(run=lambda *a, **kw: searched)
    llm = SimpleNamespace(generate=lambda messages: generated)
    rag = SimpleNamespace(run=lambda *a, **kw: answered)
    app = SimpleNamespace(state=SimpleNamespace(semantic_search=search, llm=llm, rag=rag))
    observer = Observer(app, {"d": "synthetic-document"})
    messages = [
        {"content": "unchanged-system"},
        {"content": json.dumps({"untrusted_sources": [source]})},
    ]
    original = json.dumps(messages)
    assert search.run(None, None, SimpleNamespace(query="synthetic-question")) is searched
    assert llm.generate(messages) is generated
    assert rag.run() is answered
    assert json.dumps(messages) == original
    assert observer.current["retrieved"][0]["document"] == "synthetic-document"
    assert source.get("document") is None


def test_published_baseline_counts_recompute_without_models(corpus):
    import hashlib

    from evaluation.corpus import PATH

    baseline = json.loads(PATH.with_name("baseline.json").read_text(encoding="utf-8"))
    canonical = json.dumps(corpus, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    assert (
        baseline["corpus"]["canonical_json_sha256"]
        == hashlib.sha256(canonical.encode()).hexdigest()
    )
    rows = [row["metrics"] for row in baseline["results"]]
    computed = summarize(rows)
    assert all(baseline["summary"][key] == value for key, value in computed.items())
    assert len(rows) == 32 and baseline["summary"]["total_llm_calls_including_primers"] == 36
    assert {row["case_id"] for row in rows} == {case["id"] for case in corpus["cases"]}


def test_cleanup_refuses_wrong_ownership(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "ROOT", tmp_path)
    (tmp_path / "backend/app").mkdir(parents=True)
    commands = []

    def fake(args, **kwargs):
        commands.append(args)
        if (
            args[:2] == ["docker", "run"]
            and "--name" in args
            and "worker" in args[args.index("--name") + 1]
        ):
            raise subprocess.CalledProcessError(2, args)
        result = b"synthetic"
        if args[:2] == ["docker", "inspect"]:
            result = json.dumps({"ragvault.evaluation": "different-owner"}).encode()
        return subprocess.CompletedProcess(args, 0, stdout=result, stderr=b"")

    monkeypatch.setattr(run.subprocess, "run", fake)
    with pytest.raises(RuntimeError, match="cleanup_ownership_failed"):
        run.run(["coordinator"], 1)
    assert not any(args[:3] == ["docker", "rm", "-f"] for args in commands)
    meta = json.loads(next((tmp_path / ".artifacts/evaluations").glob("*/run.json")).read_text())
    assert not meta["resources_removed"]


@pytest.mark.parametrize("extra", ["other_fact", "heading"])
def test_required_fact_cannot_hide_irrelevant_text_in_one_valid_quote(corpus, extra):
    case, obs, catalog = scenario(corpus, "coordinator", "coordinator")
    document = next(d for d in corpus["documents"] if d["id"] == "field-guide")
    full_page = document["pages"][0]["text"]
    quote = corpus["facts"]["coordinator"]["quote"]
    quote = (
        quote + "\n\n" + corpus["facts"]["team_size"]["quote"]
        if extra == "other_fact"
        else "Orchard project field guide\n\n" + quote
    )
    catalog["synthetic-chunk"]["excerpt"] = full_page
    obs["context"][0]["excerpt"] = full_page
    claim = obs["response"]["claims"][0]
    claim["text"] = claim["citations"][0]["excerpt"] = quote
    result = score(corpus, case, obs, catalog)
    assert result["accepted_quote_matches"] == 1
    assert result["displayed_facts"] == ["coordinator"]
    assert not result["strict_key_pass"] and result["key_backed_claims"] == 0
    assert result["other_known_claims"] == (extra == "other_fact")
    assert result["unassessed_claims"] == (extra == "heading")


def test_one_quote_can_cover_only_required_facts_without_penalty(corpus):
    case, obs, catalog = scenario(corpus, "coordinator", "coordinator")
    case = {**case, "expected_facts": ["coordinator", "team_size"]}
    full_page = next(d for d in corpus["documents"] if d["id"] == "field-guide")["pages"][0]["text"]
    quote = "\n\n".join(corpus["facts"][key]["quote"] for key in case["expected_facts"])
    catalog["synthetic-chunk"]["excerpt"] = full_page
    obs["retrieved"][0]["excerpt"] = obs["context"][0]["excerpt"] = full_page
    claim = obs["response"]["claims"][0]
    claim["text"] = claim["citations"][0]["excerpt"] = quote
    obs["generated"]["claims"][0]["text"] = quote
    obs["generated"]["claims"][0]["citations"][0]["quote"] = quote
    result = score(corpus, case, obs, catalog)
    assert result["strict_key_pass"] and result["failures"] == []
