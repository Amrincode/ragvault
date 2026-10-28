"""Bounded diagnostics. No migrations, installs, model pulls or service starts."""

import importlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from app.core.config import Settings

ROOT = Path(__file__).resolve().parents[2]


@dataclass
class Check:
    name: str
    status: str
    message: str
    required: bool = True

    @property
    def blocking(self) -> bool:
        return self.required and self.status not in {"ok", "not_running"}


@dataclass
class Report:
    checks: list[Check]
    settings: "Settings | None" = field(default=None, repr=False)

    @property
    def ready(self) -> bool:
        return not any(check.blocking for check in self.checks)

    def render(self, *, json_output: bool = False) -> str:
        if json_output:
            return json.dumps({"ready": self.ready, "checks": [asdict(c) for c in self.checks]})
        lines = [f"[{c.status.upper()}] {c.name}: {c.message}" for c in self.checks]
        lines.append(
            "Preflight ready." if self.ready else "Preflight blocked; resolve required checks."
        )
        return "\n".join(lines)


def run_command(args: list[str], *, cwd: Path = ROOT, timeout: int = 10) -> str | None:
    """Never relay command output that could contain paths or configuration."""
    try:
        result = subprocess.run(
            args, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError, UnicodeError):
        return None


def runtime_checks() -> list[Check]:
    if sys.version_info < (3, 12):  # noqa: UP036 - diagnostic must explain an older interpreter
        return [Check("python", "incompatible", "Use Python 3.12+ and recreate the backend venv.")]
    checks = [Check("python", "ok", "Python 3.12+ is available.")]
    try:
        for name in (
            "fastapi",
            "uvicorn",
            "sqlalchemy",
            "psycopg",
            "alembic",
            "pydantic_settings",
            "httpx",
            "multipart",
            "pymupdf",
            "pgvector",
        ):
            importlib.import_module(name)
    except (ImportError, OSError):
        checks.append(
            Check(
                "backend_dependencies",
                "missing",
                (
                    "Install backend dependencies in the venv: python -m pip install -e "
                    "'./backend[dev]' (from the repository root)."
                ),
            )
        )
        return checks
    consistent = run_command([sys.executable, "-m", "pip", "check"], timeout=20) is not None
    checks.append(
        Check(
            "backend_dependencies",
            "ok" if consistent else "incompatible",
            "Backend imports and pip consistency passed."
            if consistent
            else ("Run python -m pip check, then repair the backend venv using pyproject.toml."),
        )
    )
    return checks


def docker_check() -> Check:
    docker = shutil.which("docker")
    if not docker:
        return Check(
            "docker",
            "missing",
            (
                "Optional for an external PostgreSQL server; install Docker/Compose if "
                "using the supplied database container."
            ),
            False,
        )
    if run_command([docker, "info", "--format", "{{.ServerVersion}}"], timeout=5) is None:
        return Check(
            "docker",
            "stopped",
            (
                "Docker CLI is installed; engine is stopped or unreachable. Start "
                "Docker Desktop/Engine if using Compose PostgreSQL."
            ),
            False,
        )
    if run_command([docker, "compose", "version", "--short"], timeout=5) is None:
        return Check(
            "docker",
            "incompatible",
            (
                "Engine is available but Compose is missing; install the Compose plugin"
                " if using container workflows."
            ),
            False,
        )
    return Check(
        "docker",
        "ok",
        ("Docker Engine and Compose are reachable (optional with an external database)."),
        False,
    )


def database_check(settings: "Settings") -> Check:
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    from app.db.session import build_engine

    engine = None
    try:
        engine = build_engine(settings)
        with engine.connect() as connection:
            version = int(connection.execute(text("SHOW server_version_num")).scalar_one())
            vector = connection.execute(
                text("SELECT extversion FROM pg_extension WHERE extname='vector'")
            ).scalar_one_or_none()
            head = ScriptDirectory(str(ROOT / "backend/alembic")).get_current_head()
            revisions = (
                connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
            )
            tables = (
                "collections",
                "documents",
                "document_chunks",
                "chunk_embeddings",
                "conversations",
                "messages",
            )
            present = all(
                connection.execute(text("SELECT to_regclass(:name)"), {"name": name}).scalar_one()
                for name in tables
            )
            if version < 130000 or not vector or revisions != [head] or not present:
                return Check(
                    "postgresql",
                    "incompatible",
                    (
                        "Check PostgreSQL/pgvector compatibility and Alembic current/check. "
                        "Review backups and the upgrade runbook before explicit migrations; "
                        "preflight never migrates."
                    ),
                )
        return Check(
            "postgresql",
            "ok",
            (
                "PostgreSQL and pgvector reachable; expected migration revision and "
                "tables present. Run alembic check for full schema drift detection."
            ),
        )
    except Exception:
        # Driver and migration errors can include credentials, SQL and personal paths.
        return Check(
            "postgresql",
            "unavailable",
            (
                "Connection or compatibility inspection failed. Check the configured "
                "server/role/password, start the existing database if stopped, then run"
                " Alembic current/check. No reset is needed."
            ),
        )
    finally:
        if engine is not None:
            engine.dispose()


def get_response(url: str) -> tuple[int, bytes]:
    import httpx

    with httpx.Client(timeout=3, trust_env=False, follow_redirects=False) as client:
        with client.stream("GET", url) as response:
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > 1024 * 1024:
                    raise ValueError("Diagnostic response too large")
            return response.status_code, bytes(body)


def ollama_checks(settings: "Settings") -> list[Check]:
    names = ("chat_model", "embedding_model")
    try:
        code, raw = get_response(str(settings.ollama_base_url).rstrip("/") + "/api/tags")
        data = json.loads(raw)
        if code != 200 or not isinstance(data, dict) or not isinstance(data.get("models"), list):
            raise ValueError("Invalid model listing")
        installed = {m.get("name") for m in data["models"] if isinstance(m, dict)}
        checks = [
            Check(
                "ollama",
                "ok",
                "Ollama API is reachable; model execution is not tested by a listing.",
            )
        ]
        for name, model in zip(
            names, (settings.ollama_chat_model, settings.ollama_embedding_model), strict=True
        ):
            canonical = model if ":" in model.rsplit("/", 1)[-1] else model + ":latest"
            available = model in installed or canonical in installed
            checks.append(
                Check(
                    name,
                    "ok" if available else "missing",
                    "Configured model is installed."
                    if available
                    else (
                        "Configured model is absent. Review Ollama list and explicitly install "
                        "the configured model if desired; nothing is downloaded automatically."
                    ),
                )
            )
        return checks
    except Exception:
        return [
            Check(
                "ollama",
                "unavailable",
                (
                    "Ollama API is unreachable or returned an invalid response. Start "
                    "Ollama and check OLLAMA_BASE_URL; model checks could not run."
                ),
            )
        ]


def writable_directory(path: Path) -> bool:
    "Touch only a uniquely created probe; never enumerate or modify stored documents."
    try:
        if path.is_symlink():
            return False
        while not path.exists():
            path = path.parent
        if not path.is_dir():
            return False
        with tempfile.TemporaryFile(prefix=".ragvault-preflight-", dir=path) as probe:
            probe.write(b"permission probe")
            probe.flush()
        return True
    except OSError:
        return False


def storage_check(settings: "Settings") -> Check:
    paths = [settings.upload_dir, settings.upload_dir / ".tmp", settings.upload_dir / ".trash"]
    good = all(writable_directory(path) for path in paths)
    return Check(
        "storage",
        "ok" if good else "unavailable",
        (
            "Upload/staging/quarantine locations passed temporary write checks; no "
            "documents were opened."
        )
        if good
        else (
            "Check upload-directory permissions and symlinks. No existing file was "
            "changed or removed."
        ),
    )


def port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


def api_url(settings: "Settings") -> str:
    host = "[::1]" if settings.backend_host == "::1" else "127.0.0.1"
    return f"http://{host}:{settings.backend_port}"


def service_check(name: str, url: str, *, environment: str = "development") -> Check:
    parsed = urlsplit(url)
    if not port_open(parsed.hostname or "127.0.0.1", parsed.port or 80):
        return Check(
            name, "not_running", "Port is free; the development launcher may start this service."
        )
    try:
        code, raw = get_response(url + "/")
        if name == "fastapi":
            data = json.loads(raw)
            matched = (
                code == 200
                and data.get("name") == "RAGVault API"
                and data.get("environment") == environment
            )
            if matched:
                health_code, health_raw = get_response(url + "/api/health")
                health = json.loads(health_raw)
                if (
                    health_code != 200
                    or health.get("application") != "ok"
                    or health.get("status") != "ok"
                ):
                    return Check(
                        name,
                        "unavailable",
                        (
                            "Existing RAGVault API is degraded. Check /api/health and dependency "
                            "diagnostics; it will not be restarted."
                        ),
                    )
        else:
            matched = code == 200 and b"RAGVault" in raw and b"/@vite/client" in raw
        if matched:
            return Check(
                name,
                "ok",
                (
                    "Existing RAGVault service detected; reuse it. Its running "
                    "configuration is not independently compared to .env."
                ),
            )
    except Exception:
        pass
    return Check(
        name,
        "conflict",
        (
            "Port is occupied by an unrecognized/unresponsive service or a "
            "different app environment. Identify it and choose consistent free "
            "ports; no process will be killed."
        ),
    )


def frontend_checks(settings: "Settings") -> list[Check]:
    from dotenv import dotenv_values

    checks = []
    node = shutil.which("node")
    version = run_command([node, "--version"]) if node else None
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", version or "")
    valid = match is not None and tuple(map(int, match.groups())) >= (22, 12, 0)
    checks.append(
        Check(
            "node",
            "ok" if valid else "missing",
            "Node meets frontend package engines (22.12+); Node 24 is used in CI."
            if valid
            else ("Install Node 24 (or supported 22.12+) and npm; then run npm ci in frontend."),
        )
    )
    if valid:
        probe = (
            "const fs=require('node:fs'),p=require('./package.json'); for(const n of "
            "Object.keys({...p.dependencies,...p.devDependencies})) "
            "JSON.parse(fs.readFileSync('node_modules/'+n+'/package.json','utf8'));"
        )
        good = run_command([node, "-e", probe], cwd=ROOT / "frontend") is not None
        checks.append(
            Check(
                "frontend_dependencies",
                "ok" if good else "missing",
                "Declared frontend package manifests are present; "
                "use npm ci after lockfile changes."
                if good
                else "Frontend packages are missing or incomplete. Run npm ci in frontend.",
            )
        )
    local = (
        settings.frontend_origin.host in {"localhost", "127.0.0.1", "::1"}
        and settings.frontend_origin.scheme == "http"
    )
    values = dotenv_values(ROOT / ".env")
    value = os.environ.get(
        "VITE_API_BASE_URL", values.get("VITE_API_BASE_URL") or "http://localhost:8000"
    )
    try:
        parsed = urlsplit(value)
        matching = (
            parsed.scheme == "http"
            and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
            and (parsed.port or 80) == settings.backend_port
            and not (
                parsed.username
                or parsed.password
                or parsed.query
                or parsed.fragment
                or parsed.path not in ("", "/")
            )
        )
    except ValueError:
        matching = False
    checks.append(
        Check(
            "frontend_configuration",
            "ok" if local and matching else "invalid",
            "HTTP loopback frontend/API origins and backend port agree."
            if local and matching
            else (
                "For this native dev workflow, use HTTP loopback FRONTEND_ORIGIN and "
                "VITE_API_BASE_URL with the configured BACKEND_PORT. Existing settings "
                "were not changed."
            ),
        )
    )
    if local:
        checks.append(service_check("frontend", settings.cors_origin))
    writable = writable_directory(ROOT / "frontend/public/pdfjs")
    checks.append(
        Check(
            "frontend_assets",
            "ok" if writable else "unavailable",
            "Generated PDF asset directory is writable."
            if writable
            else "Check frontend/public permissions so the local PDF assets can be prepared.",
        )
    )
    return checks


def preflight(*, backend_only: bool = False) -> Report:
    checks = runtime_checks()
    if any(c.blocking for c in checks):
        return Report(checks)
    from app.core.config import ConfigurationError, get_settings

    try:
        settings = get_settings()
    except ConfigurationError as exc:
        return Report([*checks, Check("configuration", "invalid", str(exc))])
    checks.append(
        Check(
            "configuration",
            "ok",
            f"Validated {settings.app_env} settings; environment overrides retained. "
            "Values are redacted.",
        )
    )
    local = settings.backend_host in {"127.0.0.1", "localhost", "::1"}
    checks.append(
        Check(
            "local_binding",
            "ok" if local else "invalid",
            "Native development bind is loopback."
            if local
            else (
                "This launcher requires a loopback BACKEND_HOST. Container binding "
                "remains a separate explicit workflow."
            ),
        )
    )
    checks.extend([docker_check(), database_check(settings), storage_check(settings)])
    checks.extend(ollama_checks(settings))
    if local:
        checks.append(service_check("fastapi", api_url(settings), environment=settings.app_env))
    if not backend_only:
        checks.extend(frontend_checks(settings))
    return Report(checks, settings)
