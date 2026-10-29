"""Explicit live synthetic benchmark, always on new disposable Docker resources."""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent.parent
PUBLIC_PREFIXES = (
    "CHAT_",
    "RAG_",
    "EMBEDDING_",
    "CHUNK_",
    "MAX_",
    "CONVERSATION_",
    "PROCESSING_",
    "PDF_VALIDATION_",
)


def application_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*.py")):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def configuration() -> dict[str, str]:
    values = {**dotenv_values(ROOT / ".env"), **os.environ}
    result = {
        key: value
        for key, value in values.items()
        if value is not None
        and (
            key.startswith(PUBLIC_PREFIXES)
            or key in {"OLLAMA_CHAT_MODEL", "OLLAMA_EMBEDDING_MODEL"}
        )
    }
    url = values.get("OLLAMA_DOCKER_BASE_URL")
    if not url:
        parts = urlsplit(values.get("OLLAMA_BASE_URL") or "http://localhost:11434")
        if parts.hostname in {"localhost", "127.0.0.1", "::1"}:
            if parts.username or parts.password:
                raise ValueError("credentialed_service_url")
            parts = parts._replace(netloc="host.docker.internal:" + str(parts.port or 11434))
        url = urlunsplit(parts)
    result["OLLAMA_BASE_URL"] = url
    return result


def new_output(nonce: str) -> Path:
    parent = ROOT / ".artifacts" / "evaluations"
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    for path in (ROOT / ".artifacts", parent):
        if path.is_symlink() or path.is_junction() or path.resolve() != path:
            raise ValueError("redirected_output")
    output = parent / (nonce + ".ragvault-eval")
    output.mkdir(mode=0o700)
    return output


def run(cases: list[str], trials: int) -> int:
    nonce = uuid4().hex
    output = new_output(nonce)
    network = "ragvault-eval-" + nonce
    database = "ragvault-eval-db-" + nonce
    worker = "ragvault-eval-worker-" + nonce
    created = []
    label = "ragvault.evaluation=" + nonce
    log = open(
        output / "run.log",
        "x",
        encoding="utf-8",
        opener=lambda path, flags: os.open(path, flags, 0o600),
    )
    metadata = {
        "run_id": nonce,
        "selected_cases": cases,
        "trials": trials,
        "status": "incomplete",
        "resources_removed": False,
        "application_sha256": application_hash(ROOT / "backend/app"),
    }

    def command(args, *, capture=False, timeout=60):
        return subprocess.run(
            args,
            stdout=subprocess.PIPE if capture else log,
            stderr=subprocess.PIPE if capture else subprocess.STDOUT,
            check=True,
            timeout=timeout,
        )

    def remove(kind, name):
        args = (
            ["docker", "inspect", name]
            if kind == "container"
            else ["docker", "network", "inspect", name]
        )
        info = subprocess.run(
            [
                *args,
                "--format",
                "{{json .Config.Labels}}" if kind == "container" else "{{json .Labels}}",
            ],
            capture_output=True,
        )
        if info.returncode:
            # --rm may already have removed the exact owned worker after exit.
            listing = command(["docker", "ps", "-a", "--format", "{{.Names}}"], capture=True)
            if kind == "container" and name not in listing.stdout.decode().splitlines():
                return
            raise RuntimeError("cleanup_inspection_failed")
        if json.loads(info.stdout).get("ragvault.evaluation") != nonce:
            raise RuntimeError("cleanup_ownership_failed")
        command(
            ["docker", "rm", "-f", name]
            if kind == "container"
            else ["docker", "network", "rm", name]
        )

    try:
        for image in ("ragvault-backend:latest", "ragvault-postgres:17-vector"):
            metadata[image] = (
                command(["docker", "image", "inspect", image, "--format", "{{.Id}}"], capture=True)
                .stdout.decode()
                .strip()
            )
        metadata["base_commit"] = (
            command(["git", "rev-parse", "HEAD"], capture=True).stdout.decode().strip()
        )
        command(["docker", "network", "create", "--label", label, network])
        created.append(("network", network))
        command(
            [
                "docker",
                "run",
                "--pull=never",
                "--rm",
                "-d",
                "--name",
                database,
                "--label",
                label,
                "--network",
                network,
                "--tmpfs",
                "/var/lib/postgresql/data",
                "-e",
                "POSTGRES_DB=ragvault_eval",
                "-e",
                "POSTGRES_USER=ragvault_eval",
                "-e",
                "POSTGRES_PASSWORD=synthetic-evaluation-only",
                "ragvault-postgres:17-vector",
            ]
        )
        created.append(("container", database))
        for _ in range(40):
            ready = subprocess.run(
                [
                    "docker",
                    "exec",
                    database,
                    "pg_isready",
                    "-U",
                    "ragvault_eval",
                    "-d",
                    "ragvault_eval",
                ],
                stdout=log,
                stderr=log,
            )
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("owned_database_unavailable")
        env = configuration()
        env.update(
            {
                "APP_ENV": "test",
                "POSTGRES_HOST": database,
                "POSTGRES_PORT": "5432",
                "POSTGRES_DB": "ragvault_eval",
                "POSTGRES_USER": "ragvault_eval",
                "POSTGRES_PASSWORD": "synthetic-evaluation-only",
                "UPLOAD_DIR": "/tmp/ragvault-eval-uploads",
                "RAGVAULT_EVAL_RUN_ID": nonce,
                "RAGVAULT_EVAL_TRIALS": str(trials),
                "RAGVAULT_EVAL_CASES": json.dumps(cases),
                "RAGVAULT_EVAL_APP_SHA": metadata["application_sha256"],
                "LOG_LEVEL": "WARNING",
            }
        )
        flags = [part for key, value in env.items() for part in ("-e", key + "=" + value)]
        command(
            [
                "docker",
                "run",
                "--pull=never",
                "--rm",
                "--network",
                network,
                *flags,
                "ragvault-backend:latest",
                "python",
                "-m",
                "alembic",
                "upgrade",
                "head",
            ]
        )
        # Registration before foreground launch ensures cancellation cleanup can find it.
        created.append(("container", worker))
        command(
            [
                "docker",
                "run",
                "--pull=never",
                "--rm",
                "--name",
                worker,
                "--label",
                label,
                "--network",
                network,
                *flags,
                "--tmpfs",
                "/tmp",
                "-v",
                str(ROOT / "backend/evaluation") + ":/evaluation:ro",
                "-v",
                str(output) + ":/results",
                "-e",
                "PYTHONPATH=/app:/",
                "ragvault-backend:latest",
                "python",
                "-m",
                "evaluation.worker",
            ],
            timeout=7200,
        )
        data = json.loads((output / "results.json").read_text(encoding="utf-8"))
        metadata["status"] = "completed" if data["model_identity_stable"] else "invalid_model_drift"
        print(json.dumps({"run_id": nonce, "summary": data["summary"]}), flush=True)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        print(
            "Evaluation incomplete; inspect local-only results. Raw diagnostics withheld.",
            flush=True,
        )
    except KeyboardInterrupt:
        print("Evaluation interrupted; removing only owned disposable resources.", flush=True)
    finally:
        try:
            for kind, name in reversed(created):
                remove(kind, name)
            metadata["resources_removed"] = True
        finally:
            log.close()
            with open(
                output / "run.json",
                "x",
                encoding="utf-8",
                opener=lambda path, flags: os.open(path, flags, 0o600),
            ) as stream:
                json.dump(metadata, stream, indent=2)
    return 0 if metadata["status"] == "completed" and metadata["resources_removed"] else 2


def main() -> int:
    # Corpus selection needs only JSON; the host does not import native PDF/SQL libraries.
    corpus = json.loads(Path(__file__).with_name("corpus.json").read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", action="append", choices=[c["id"] for c in corpus["cases"]])
    parser.add_argument("--trials", type=int, choices=range(1, 6), default=2)
    parser.add_argument(
        "--list", action="store_true", help="List cases without Docker or model calls"
    )
    args = parser.parse_args()
    if args.list:
        for case in corpus["cases"]:
            print(case["id"] + " : " + case["category"])
        return 0
    return run(args.case or [c["id"] for c in corpus["cases"]], args.trials)


if __name__ == "__main__":
    sys.exit(main())
