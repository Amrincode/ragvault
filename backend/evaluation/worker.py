"""Container-only live worker. Observers copy results and never change decisions."""

import hashlib
import json
import os
import platform
from importlib.metadata import version
from pathlib import Path
from time import monotonic
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

import app as application
from app.core.config import Settings
from app.db.session import build_engine
from app.main import create_app
from app.models import Document, DocumentChunk
from app.services.embeddings import canonical_model
from evaluation.corpus import identity, load, render
from evaluation.metrics import score, summarize
from evaluation.run import application_hash

OUTPUT = Path("/results")


def write(name, value):
    with open(
        OUTPUT / name, "x", encoding="utf-8", opener=lambda path, flags: os.open(path, flags, 0o600)
    ) as target:
        json.dump(value, target, indent=2, ensure_ascii=True)


def guard(settings, nonce):
    if (
        len(nonce) != 32
        or any(c not in "0123456789abcdef" for c in nonce)
        or settings.postgres_host != "ragvault-eval-db-" + nonce
        or settings.postgres_db != "ragvault_eval"
        or settings.app_env != "test"
        or settings.upload_dir != Path("/tmp/ragvault-eval-uploads")
    ):
        raise RuntimeError("isolation_guard_failed")
    engine = build_engine(settings)
    try:
        with engine.connect() as connection:
            if (
                connection.execute(text("SELECT current_database()")).scalar_one()
                != "ragvault_eval"
            ):
                raise RuntimeError("isolation_guard_failed")
            for table in (
                "collections",
                "documents",
                "document_chunks",
                "chunk_embeddings",
                "conversations",
                "messages",
            ):
                if connection.execute(text("SELECT count(*) FROM " + table)).scalar_one():
                    raise RuntimeError("evaluation_database_not_empty")
    finally:
        engine.dispose()


class Observer:
    def __init__(self, app, documents):
        self.current = {}
        self.model_calls = 0
        self.documents = documents
        search, llm, rag = app.state.semantic_search, app.state.llm, app.state.rag
        original_search, original_generate, original_run = search.run, llm.generate, rag.run

        def search_run(*args, **kwargs):
            result = original_search(*args, **kwargs)
            self.current["retrieved"] = [
                self.source(s.model_dump(mode="json")) for s in result.items
            ]
            self.current["retrieval_query"] = args[2].query
            self.current["search_ms"] = result.elapsed_ms
            return result

        def generate(messages):
            self.current["context"] = [
                self.source(s) for s in json.loads(messages[1]["content"])["untrusted_sources"]
            ]
            self.current["context_measured"] = True
            self.current["conversation_topics"] = json.loads(messages[1]["content"]).get(
                "untrusted_conversation_topics", []
            )
            self.current["input_utf8_bytes"] = sum(len(m["content"].encode()) for m in messages)
            self.current["llm_calls"] = self.current.get("llm_calls", 0) + 1
            self.model_calls += 1
            try:
                result = original_generate(messages)
                self.current["generated"] = result.model_dump(mode="json")
                return result
            except Exception as exc:
                self.current["generation_error"] = getattr(exc, "code", "provider_failure")
                raise

        def run(*args, **kwargs):
            result = original_run(*args, **kwargs)
            self.current["response"] = result.model_dump(mode="json")
            self.current["context"] = [
                self.source(s.model_dump(mode="json")) for s in result.sources
            ]
            self.current["context_measured"] = True
            for claim in self.current["response"]["claims"]:
                claim["citations"] = [self.source(c) for c in claim["citations"]]
            return result

        search.run, llm.generate, rag.run = search_run, generate, run

    def source(self, value):
        return {**value, "document": self.documents.get(str(value["document_id"]), "unknown")}


def main():
    settings = Settings()
    nonce = os.environ.get("RAGVAULT_EVAL_RUN_ID", "")
    if application_hash(Path(application.__file__).parent) != os.environ.get(
        "RAGVAULT_EVAL_APP_SHA"
    ):
        raise RuntimeError("stale_backend_image")
    guard(settings, nonce)
    corpus = load()
    selected = json.loads(os.environ["RAGVAULT_EVAL_CASES"])
    cases = [c for c in corpus["cases"] if c["id"] in selected]
    trials = int(os.environ["RAGVAULT_EVAL_TRIALS"])
    if not cases or set(selected) != {c["id"] for c in cases} or not 1 <= trials <= 5:
        raise RuntimeError("invalid_case_selection")
    output = {
        "schema_version": 1,
        "corpus": identity(),
        "harness_sha256": application_hash(Path(__file__).parent),
        "run_id": nonce,
        "trials": trials,
        "selected_cases": selected,
        "results": [],
        "evaluation_kind": "live PostgreSQL/Ollama via actual ASGI routes; no model mocks",
        "raw_provider_response_recorded": False,
        "environment": {
            "python": platform.python_version(),
            "system": platform.system(),
            "machine": platform.machine(),
            "packages": {
                p: version(p)
                for p in ("fastapi", "sqlalchemy", "psycopg", "pymupdf", "httpx", "pgvector")
            },
        },
    }
    fields = {
        f
        for f in Settings.model_fields
        if f.startswith(
            (
                "chat_",
                "rag_",
                "embedding_",
                "chunk_",
                "max_",
                "conversation_",
                "processing_",
                "pdf_validation_",
            )
        )
    }
    fields |= {"ollama_chat_model", "ollama_embedding_model"}
    output["configuration"] = settings.model_dump(mode="json", include=fields)
    with TestClient(create_app(settings)) as client:
        app = client.app

        def models():
            response = app.state.llm.client.get("api/tags")
            response.raise_for_status()
            names = {
                canonical_model(settings.ollama_chat_model),
                canonical_model(settings.ollama_embedding_model),
            }
            return sorted(
                [
                    {k: m[k] for k in ("name", "digest", "size")}
                    for m in response.json()["models"]
                    if canonical_model(m["name"]) in names
                ],
                key=lambda m: m["name"],
            )

        output["models"] = models()
        if len(output["models"]) != 2:
            raise RuntimeError("configured_models_unavailable")
        output["ollama_version"] = app.state.llm.client.get("api/version").json().get("version")
        if client.get("/api/health").status_code != 200:
            raise RuntimeError("dependency_health_failed")
        with app.state.engine.connect() as connection:
            output["environment"]["postgres"] = connection.execute(
                text("SHOW server_version")
            ).scalar()
            output["environment"]["pgvector"] = connection.execute(
                text("SELECT extversion FROM pg_extension WHERE extname='vector'")
            ).scalar()
        collections, documents, setup = {}, {}, []

        def post(path, **kwargs):
            response = client.post(path, **kwargs)
            if response.status_code not in (200, 201):
                raise RuntimeError("setup_http_" + str(response.status_code))
            return response.json()

        for definition in corpus["documents"]:
            group = definition["collection"]
            if group not in collections:
                collections[group] = post("/api/collections", json={"name": "Evaluation " + group})[
                    "id"
                ]
            payload = render(definition)
            started = monotonic()
            doc = post(
                "/api/collections/" + collections[group] + "/documents",
                files={"file": (definition["id"] + ".pdf", payload, "application/pdf")},
            )
            uploaded_at = monotonic()
            processed = post("/api/documents/" + doc["id"] + "/process")
            processed_at = monotonic()
            indexed = post("/api/documents/" + doc["id"] + "/index")
            if (
                processed["processing_status"] != "processed"
                or indexed["indexing_status"] != "indexed"
            ):
                raise RuntimeError("corpus_setup_failed")
            documents[definition["id"]] = doc["id"]
            setup.append(
                {
                    "document": definition["id"],
                    "pdf_sha256": hashlib.sha256(payload).hexdigest(),
                    "chunks": indexed["chunk_count"],
                    "pages": indexed["page_count"],
                    "dimensions": indexed["embedding_dimensions"],
                    "upload_wall_ms": round((uploaded_at - started) * 1000, 2),
                    "processing_wall_ms": round((processed_at - uploaded_at) * 1000, 2),
                    "indexing_wall_ms": round((monotonic() - processed_at) * 1000, 2),
                    "elapsed_ms": round((monotonic() - started) * 1000, 2),
                }
            )
        output["setup"] = setup
        observer = Observer(app, {value: key for key, value in documents.items()})
        catalog = {}
        with Session(app.state.engine) as session:
            for chunk, doc in session.execute(
                select(DocumentChunk, Document).join(
                    Document, Document.id == DocumentChunk.document_id
                )
            ):
                catalog[str(chunk.id)] = observer.source(
                    {
                        "chunk_id": str(chunk.id),
                        "document_id": str(doc.id),
                        "collection_id": str(doc.collection_id),
                        "page_number": chunk.page_number,
                        "excerpt": chunk.text,
                    }
                )
        output["catalog"] = catalog
        for trial in range(1, trials + 1):
            for case in cases:
                scope = {
                    "collection_id": collections.get(case["collection"]),
                    "document_id": documents.get(case["document"]),
                }
                conversation = None
                primers = []
                if case["prior_questions"]:
                    conversation = post(
                        "/api/conversations", json={"title": "Synthetic evaluation", **scope}
                    )["id"]
                    for question in case["prior_questions"]:
                        observer.current = {}
                        reply = client.post(
                            "/api/conversations/" + conversation + "/messages",
                            json={"question": question, "request_id": str(uuid4())},
                        )
                        primers.append(
                            {"http_status": reply.status_code, "observation": observer.current}
                        )
                observer.current = {}
                started = monotonic()
                if conversation:
                    reply = client.post(
                        "/api/conversations/" + conversation + "/messages",
                        json={"question": case["question"], "request_id": str(uuid4())},
                    )
                else:
                    reply = client.post("/api/chat", json={"question": case["question"], **scope})
                observation = observer.current
                observation["http_status"] = reply.status_code
                observation["wall_ms"] = round((monotonic() - started) * 1000, 2)
                if reply.status_code != 200 or not observation.get("response"):
                    data = reply.json()
                    detail = data.get("detail", {})
                    observation["error"] = (
                        detail.get("code", "no_rag_response")
                        if isinstance(detail, dict)
                        else "request_failure"
                    )
                metrics = score(corpus, case, observation, catalog)
                row = {
                    "case_id": case["id"],
                    "trial": trial,
                    "question": case["question"],
                    "scope": scope,
                    "primers": primers,
                    "observation": observation,
                    "metrics": metrics,
                }
                output["results"].append(row)
                # A checkpoint is local-only. Never dump private bodies to stdout.
                checkpoint = OUTPUT / "checkpoint.json"
                with open(
                    checkpoint,
                    "w",
                    encoding="utf-8",
                    opener=lambda path, flags: os.open(path, flags, 0o600),
                ) as stream:
                    json.dump(output, stream, ensure_ascii=True)
                print(
                    json.dumps(
                        {"case": case["id"], "trial": trial, "failures": metrics["failures"]}
                    ),
                    flush=True,
                )
                if conversation:
                    if client.delete("/api/conversations/" + conversation).status_code != 204:
                        raise RuntimeError("owned_conversation_cleanup_failed")
        output["model_identity_stable"] = models() == output["models"]
        output["summary"] = summarize([r["metrics"] for r in output["results"]])
        output["summary"]["total_llm_calls_including_primers"] = observer.model_calls
        output["summary"]["primer_requests"] = sum(len(r["primers"]) for r in output["results"])
        # All owned records remain only until their disposable container is removed.
        output["remaining_owned_collections"] = len(client.get("/api/collections").json())
    write("results.json", output)
    write("summary.json", output["summary"])
    return 0 if output["model_identity_stable"] else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Do not serialize DB URLs, raw provider responses, prompts or host paths.
        known = {
            "stale_backend_image",
            "isolation_guard_failed",
            "evaluation_database_not_empty",
            "invalid_case_selection",
            "configured_models_unavailable",
            "dependency_health_failed",
            "corpus_setup_failed",
            "owned_conversation_cleanup_failed",
        }
        code = str(exc) if isinstance(exc, RuntimeError) and str(exc) in known else "worker_failure"
        write(
            "worker-failure.json",
            {"status": "incomplete", "error": code, "error_type": type(exc).__name__},
        )
        print("Evaluation incomplete; local-only diagnostics retained.", flush=True)
        raise SystemExit(2) from None
