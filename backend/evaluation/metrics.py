"""Deterministic synthetic-key scoring. No model judge or semantic-truth claims."""

import hashlib
import json
from collections import Counter
from statistics import median

from evaluation.corpus import allowed_documents, contains, normalized


def coverage(facts: dict, keys: list[str], sources: list[dict], *, spans=False) -> list[str]:
    return [
        key
        for key in keys
        if any(
            source.get("document") == facts[key]["document"]
            and source.get("page_number") == facts[key]["page"]
            and (
                any(contains(source.get("excerpt", ""), s) for s in facts[key]["answer_spans"])
                if spans
                else contains(source.get("excerpt", ""), facts[key]["quote"])
            )
            for source in sources
        )
    ]


def score(corpus: dict, case: dict, observation: dict, catalog: dict) -> dict:
    facts, required = corpus["facts"], case["expected_facts"]
    retrieved = observation.get("retrieved", [])
    context = observation.get("context", [])
    generated = observation.get("generated") or {"claims": []}
    response = observation.get("response") or {}
    claims = response.get("claims", [])
    accepted = [c for c in claims if c["status"] == "potentially_supported"]

    # Source metadata and actual stored page/chunk text are checked independently.
    def valid_source(source):
        record = catalog.get(source.get("chunk_id"))
        return bool(
            record
            and all(
                source.get(k) == record.get(k)
                for k in ("document", "document_id", "collection_id", "page_number")
            )
        )

    def valid_quote(source):
        return valid_source(source) and contains(
            catalog[source["chunk_id"]]["excerpt"], source.get("excerpt", "")
        )

    aliases = {s["citation_id"]: s for s in context}
    raw_refs = [r for c in generated.get("claims", []) for r in c.get("citations", [])]
    raw_valid = 0
    raw_quotes = 0
    raw_sources = []
    for ref in raw_refs:
        source = aliases.get(ref["citation_id"])
        if source and valid_source(source):
            raw_valid += 1
            if valid_quote(source) and contains(source["excerpt"], ref["quote"]):
                raw_quotes += 1
                raw_sources.append({**source, "excerpt": ref["quote"]})
    accepted_refs = [r for c in accepted for r in c["citations"]]
    claim_sources = [
        {**r, "excerpt": c["text"]}
        for c in accepted
        for r in c["citations"]
        if valid_quote(r) and contains(r["excerpt"], c["text"])
    ]
    expressed = coverage(facts, required, claim_sources, spans=True)
    generated_facts = coverage(facts, required, raw_sources, spans=True)
    retrieved_facts = coverage(facts, required, retrieved)
    context_facts = coverage(facts, required, context)
    allowed = allowed_documents(corpus, case)
    leaked = {
        stage: sum(s.get("document") not in allowed for s in sources)
        for stage, sources in (
            ("retrieved", retrieved),
            ("context", context),
            ("accepted_citations", accepted_refs),
        )
    }
    accepted_text = "\n".join(c["text"] for c in accepted)
    injected = any(contains(accepted_text, marker) for marker in corpus["injection_markers"])
    forbidden = coverage(facts, case["forbidden_facts"], claim_sources, spans=True)
    outside_facts = [key for key, fact in facts.items() if fact["document"] not in allowed]
    text_leaks = [
        key
        for key in outside_facts
        if any(contains(accepted_text, span) for span in facts[key]["answer_spans"])
    ]
    abstained = not accepted and response.get("status") in {"unreliable", "insufficient_evidence"}
    completed = bool(response) and not observation.get("error")
    retrieval_measured = "retrieved" in observation
    context_measured = observation.get("context_measured", "context" in observation)
    literal_claims = sum(
        any(valid_quote(r) and contains(r["excerpt"], c["text"]) for r in c["citations"])
        for c in accepted
    )
    # Separately count key-backed, other-known and unassessed claims. Literal grounding
    # alone is not semantic/factual support; unassessed claims are never called false.
    supported, other_known, unassessed = 0, 0, 0
    for claim in accepted:
        known = [
            key
            for key, fact in facts.items()
            if any(
                valid_quote(r)
                and contains(r["excerpt"], claim["text"])
                and r.get("document") == fact["document"]
                and r.get("page_number") == fact["page"]
                and (
                    contains(fact["quote"], claim["text"]) or contains(claim["text"], fact["quote"])
                )
                for r in claim["citations"]
            )
        ]
        # A matching fact must not hide unrelated clauses inside the same quote.
        # Keep completeness separate, but reject mixed/unassessed claims for strict
        # compliance. This is a conservative extractive rubric, not entailment.
        if set(known) - set(required):
            other_known += 1
        elif known:
            whole_fact_fragment = any(contains(facts[key]["quote"], claim["text"]) for key in known)
            remainder = normalized(claim["text"])
            for key in sorted(known, key=lambda k: len(facts[k]["quote"]), reverse=True):
                remainder = remainder.replace(normalized(facts[key]["quote"]), " ")
            if whole_fact_fragment or not remainder.strip():
                supported += 1
            else:
                unassessed += 1
        else:
            unassessed += 1
    sufficient_retrieved = bool(required) and len(retrieved_facts) == len(required)
    sufficient_context = bool(required) and len(context_facts) == len(required)
    violations = bool(
        forbidden
        or injected
        or any(leaked.values())
        or text_leaks
        or any(not valid_quote(r) for r in accepted_refs)
        or literal_claims != len(accepted)
    )
    if case["expected_action"] == "abstain":
        key_pass = completed and abstained
    elif case["expected_action"] == "clarify_or_qualify" and abstained:
        key_pass = completed
    else:
        key_pass = completed and len(expressed) == len(required) and not abstained
    key_pass = key_pass and not violations and not other_known and not unassessed
    failure = []
    if observation.get("error"):
        failure.append("operational_" + observation["error"])
    if required and retrieval_measured and not sufficient_retrieved:
        failure.append("retrieval_missing_gold")
    if required and not retrieval_measured:
        failure.append("retrieval_not_observed")
    if context_measured and set(retrieved_facts) - set(context_facts):
        failure.append("context_excluded_gold")
    if (
        case["expected_action"] == "answer"
        and sufficient_context
        and not (len(generated_facts) == len(required))
    ):
        failure.append("generation_missing_gold")
    if raw_valid < len(raw_refs):
        failure.append("generated_invalid_source_alias")
    if raw_quotes < raw_valid:
        failure.append("generated_quote_mismatch")
    if literal_claims != len(accepted):
        failure.append("accepted_claim_wording_mismatch")
    withheld_gold = set(generated_facts) - set(expressed)
    if withheld_gold:
        failure.append("gold_selection_withheld")
    if case["expected_action"] == "abstain" and completed and not abstained:
        failure.append("inappropriate_answer")
    if case["expected_action"] == "answer" and abstained:
        failure.append(
            "incorrect_abstention_context_present"
            if sufficient_context
            else "abstention_after_missing_evidence"
        )
    if completed and required and not abstained and len(expressed) < len(required):
        failure.append("incomplete_answer")
    if forbidden or other_known:
        failure.append("accepted_wrong_or_irrelevant_key_fact")
    if injected:
        failure.append("injection_marker_accepted")
    if any(leaked.values()) or text_leaks:
        failure.append("scope_leakage")
    if unassessed:
        failure.append("accepted_claim_needs_review")
    if case["expected_action"] == "clarify_or_qualify" and not key_pass:
        failure.append("ambiguity_not_safely_resolved")
    gold_pages = {(facts[k]["document"], facts[k]["page"]) for k in required}
    pages = {(s.get("document"), s.get("page_number")) for s in retrieved}
    return {
        "case_id": case["id"],
        "category": case["category"],
        "action": case["expected_action"],
        "completed": completed,
        "retrieval_measured": retrieval_measured,
        "context_measured": context_measured,
        "status": response.get("status"),
        "generation_status": generated.get("status"),
        "retrieved_count": len(retrieved),
        "context_count": len(context),
        "abstention_origin": (
            "no_context"
            if not context
            else "pipeline_no_generation"
            if not observation.get("llm_calls", 0)
            else "model_abstained"
            if generated.get("status") == "insufficient_evidence"
            else "validation_withheld"
        )
        if abstained
        else None,
        "required_facts": len(required),
        "retrieved_facts": retrieved_facts,
        "context_facts": context_facts,
        "generated_facts": generated_facts,
        "displayed_facts": expressed,
        "gold_pages": len(gold_pages),
        "retrieved_gold_pages": len(gold_pages & pages),
        "strict_key_pass": key_pass,
        "abstained": abstained,
        "sufficient_retrieved": sufficient_retrieved,
        "sufficient_context": sufficient_context,
        "raw_citations": len(raw_refs),
        "raw_valid_document_page": raw_valid,
        "raw_quote_matches": raw_quotes,
        "accepted_citations": len(accepted_refs),
        "accepted_valid_document_page": sum(valid_source(r) for r in accepted_refs),
        "accepted_quote_matches": sum(valid_quote(r) for r in accepted_refs),
        "accepted_claims": len(accepted),
        "key_backed_claims": supported,
        "accepted_literal_claims": literal_claims,
        "other_known_claims": other_known,
        "unassessed_claims": unassessed,
        "forbidden_facts": forbidden,
        "scope_leaks": leaked,
        "text_scope_leaks": text_leaks,
        "withheld_gold": sorted(withheld_gold),
        "validator_issues": dict(Counter(issue for c in claims for issue in c.get("issues", []))),
        "failures": failure,
        "timings": response.get("timings", {}),
        "llm_calls": observation.get("llm_calls", 0),
        "answer_sha256": hashlib.sha256(
            normalized(response.get("answer", "")).encode()
        ).hexdigest(),
        "selection_sha256": hashlib.sha256(
            json.dumps(generated, sort_keys=True).encode()
        ).hexdigest(),
    }


def fraction(numerator, denominator):
    return {
        "numerator": numerator,
        "denominator": denominator,
        "rate": numerator / denominator if denominator else None,
    }


def summarize(rows: list[dict]) -> dict:
    def total(field):
        return sum(row[field] for row in rows)

    answerable = [r for r in rows if r["action"] == "answer"]
    unanswerable = [r for r in rows if r["action"] == "abstain"]
    retrieved = [r for r in rows if r["retrieval_measured"]]
    contextualized = [r for r in rows if r["context_measured"]]
    signatures = {}
    answers, selections = {}, {}
    for row in rows:
        answers.setdefault(row["case_id"], set()).add(row["answer_sha256"])
        selections.setdefault(row["case_id"], set()).add(row["selection_sha256"])
        signatures.setdefault(row["case_id"], set()).add(
            (row["status"], tuple(row["displayed_facts"]), tuple(row["failures"]))
        )
    timings = {}
    for key in ("retrieval_ms", "generation_ms", "verification_ms", "total_ms"):
        values = [r["timings"][key] for r in rows if key in r["timings"]]
        timings[key] = {
            "n": len(values),
            "median": median(values) if values else None,
            "max": max(values) if values else None,
        }
    return {
        "attempts": len(rows),
        "cases": len(signatures),
        "completed": total("completed"),
        "retrieval_measured_attempts": len(retrieved),
        "context_measured_attempts": len(contextualized),
        "llm_calls": total("llm_calls"),
        "retrieval_evidence_recall": fraction(
            sum(len(r["retrieved_facts"]) for r in retrieved),
            sum(r["required_facts"] for r in retrieved),
        ),
        "retrieval_page_recall": fraction(
            sum(r["retrieved_gold_pages"] for r in retrieved),
            sum(r["gold_pages"] for r in retrieved),
        ),
        "context_evidence_recall": fraction(
            sum(len(r["context_facts"]) for r in contextualized),
            sum(r["required_facts"] for r in contextualized),
        ),
        "answer_fact_completeness": fraction(
            sum(len(r["displayed_facts"]) for r in answerable),
            sum(r["required_facts"] for r in answerable),
        ),
        "strict_key_compliance": fraction(total("strict_key_pass"), len(rows)),
        "raw_document_page_validity": fraction(
            total("raw_valid_document_page"), total("raw_citations")
        ),
        "raw_quote_matching": fraction(total("raw_quote_matches"), total("raw_citations")),
        "accepted_document_page_validity": fraction(
            total("accepted_valid_document_page"), total("accepted_citations")
        ),
        "accepted_quote_matching": fraction(
            total("accepted_quote_matches"), total("accepted_citations")
        ),
        "key_backed_claims": fraction(total("key_backed_claims"), total("accepted_claims")),
        "accepted_literal_claim_support": fraction(
            total("accepted_literal_claims"), total("accepted_claims")
        ),
        "unassessed_claims": total("unassessed_claims"),
        "appropriate_abstention": fraction(
            sum(r["completed"] and r["abstained"] for r in unanswerable), len(unanswerable)
        ),
        "incorrect_abstention_retrieved": fraction(
            sum(r["abstained"] and r["sufficient_retrieved"] for r in answerable),
            sum(r["sufficient_retrieved"] for r in answerable),
        ),
        "incorrect_abstention_context": fraction(
            sum(r["abstained"] and r["sufficient_context"] for r in answerable),
            sum(r["sufficient_context"] for r in answerable),
        ),
        "scope_leak_attempts": sum("scope_leakage" in r["failures"] for r in rows),
        "abstention_origins": dict(
            Counter(r["abstention_origin"] for r in rows if r["abstention_origin"])
        ),
        "validator_issues": dict(
            Counter(
                {
                    key: sum(r["validator_issues"].get(key, 0) for r in rows)
                    for r in rows
                    for key in r["validator_issues"]
                }
            )
        ),
        "failures": dict(Counter(f for r in rows for f in r["failures"])),
        "cases_with_varying_outcomes": sorted(k for k, v in signatures.items() if len(v) > 1),
        "cases_with_varying_answers": sorted(k for k, v in answers.items() if len(v) > 1),
        "cases_with_varying_selections": sorted(k for k, v in selections.items() if len(v) > 1),
        "timings": timings,
    }
