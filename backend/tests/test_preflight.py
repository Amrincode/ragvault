import json
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app import preflight as pf
from app.core.config import Settings


@pytest.fixture
def config(tmp_path: Path) -> Settings:
    return Settings(_env_file=None, postgres_password="test", upload_dir=tmp_path / "uploads")


def test_report_json_has_only_safe_fields():
    config = Settings(_env_file=None, postgres_password="do-not-print-this")
    report = pf.Report([pf.Check("docker", "stopped", "Start Engine", False)], config)
    assert report.ready
    payload = json.loads(report.render(json_output=True))
    assert payload["ready"] and payload["checks"][0]["required"] is False
    assert "do-not-print-this" not in report.render(json_output=True) + repr(report)


def test_missing_backend_import_is_actionable_and_redacted(monkeypatch):
    def unavailable(name):
        raise ImportError("private-token /private/home")

    monkeypatch.setattr(pf.importlib, "import_module", unavailable)
    report = pf.Report(pf.runtime_checks())
    assert not report.ready
    assert "pip install" in report.render()
    assert "private-token" not in report.render()


def test_wrong_python_stops_before_imports(monkeypatch):
    monkeypatch.setattr(pf.sys, "version_info", (3, 11))
    monkeypatch.setattr(pf.importlib, "import_module", lambda name: pytest.fail("No imports"))
    assert pf.runtime_checks()[0].status == "incompatible"


@pytest.mark.parametrize("outcome", [None, "healthy"])
def test_pip_consistency_is_required(monkeypatch, outcome):
    monkeypatch.setattr(pf.importlib, "import_module", lambda name: None)
    monkeypatch.setattr(pf, "run_command", lambda *a, **k: outcome)
    assert pf.Report(pf.runtime_checks()).ready == (outcome is not None)


@pytest.mark.parametrize(
    "installed,engine,compose,status",
    [
        (False, False, False, "missing"),
        (True, False, False, "stopped"),
        (True, True, False, "incompatible"),
        (True, True, True, "ok"),
    ],
)
def test_docker_is_optional_with_external_postgresql(
    monkeypatch, installed, engine, compose, status
):
    monkeypatch.setattr(pf.shutil, "which", lambda _: "docker" if installed else None)
    monkeypatch.setattr(
        pf,
        "run_command",
        lambda args, **kw: "yes" if (engine if "info" in args else compose) else None,
    )
    check = pf.docker_check()
    assert check.status == status and not check.required and not check.blocking


@pytest.mark.parametrize(
    "failure", [FileNotFoundError("secret"), subprocess.TimeoutExpired("secret", 1)]
)
def test_command_failures_are_bounded_and_redacted(monkeypatch, failure):
    def fail(*args, **kwargs):
        assert kwargs["timeout"] == 5 and kwargs["capture_output"]
        raise failure

    monkeypatch.setattr(pf.subprocess, "run", fail)
    assert pf.run_command(["unused"], timeout=5) is None


@pytest.mark.parametrize(
    "models,states",
    [
        ([{"name": "gemma3:4b"}, {"name": "nomic-embed-text:latest"}], ["ok", "ok", "ok"]),
        ([{"name": "other:latest"}], ["ok", "missing", "missing"]),
    ],
)
def test_exact_configured_models_are_checked_without_pulls(monkeypatch, config, models, states):
    monkeypatch.setattr(
        pf, "get_response", lambda _: (200, json.dumps({"models": models}).encode())
    )
    checks = pf.ollama_checks(config)
    assert [c.status for c in checks] == states
    assert "gemma3" not in pf.Report(checks).render()


@pytest.mark.parametrize("response", [(503, b"private failure"), (200, b"not-json"), (200, b"{}")])
def test_invalid_ollama_response_is_safe(monkeypatch, config, response):
    monkeypatch.setattr(pf, "get_response", lambda _: response)
    report = pf.Report(pf.ollama_checks(config))
    assert not report.ready and "private failure" not in report.render()


def test_unreachable_ollama_is_safe(monkeypatch, config):
    def fail(url):
        raise OSError("secret connection detail")

    monkeypatch.setattr(pf, "get_response", fail)
    assert pf.ollama_checks(config)[0].status == "unavailable"


@pytest.mark.parametrize("name", ["fastapi", "frontend"])
def test_free_port_is_not_a_dependency_failure(monkeypatch, name):
    monkeypatch.setattr(pf, "port_open", lambda *a: False)
    monkeypatch.setattr(pf, "get_response", lambda _: pytest.fail("No HTTP on a free port"))
    check = pf.service_check(name, "http://127.0.0.1:8000")
    assert check.status == "not_running" and not check.blocking


@pytest.mark.parametrize(
    "name,raw",
    [
        ("fastapi", b'{"name":"Other app"}'),
        ("frontend", b"Other site"),
        ("fastapi", b'{"name":"RAGVault API","environment":"production"}'),
    ],
)
def test_occupied_ports_require_app_identity_and_environment(monkeypatch, name, raw):
    monkeypatch.setattr(pf, "port_open", lambda *a: True)
    monkeypatch.setattr(pf, "get_response", lambda _: (200, raw))
    assert pf.service_check(name, "http://localhost:8000").status == "conflict"


@pytest.mark.parametrize("health,expected", [(200, "ok"), (503, "unavailable")])
def test_existing_api_health_transitions(monkeypatch, health, expected):
    monkeypatch.setattr(pf, "port_open", lambda *a: True)

    def response(url):
        if url.endswith("/api/health"):
            return health, b'{"status":"ok","application":"ok"}'
        return 200, b'{"name":"RAGVault API","environment":"development"}'

    monkeypatch.setattr(pf, "get_response", response)
    assert pf.service_check("fastapi", "http://localhost:8000").status == expected


def test_existing_frontend_requires_vite_marker(monkeypatch):
    monkeypatch.setattr(pf, "port_open", lambda *a: True)
    monkeypatch.setattr(
        pf, "get_response", lambda _: (200, b'RAGVault <script src="/@vite/client">')
    )
    assert pf.service_check("frontend", "http://localhost:5173").status == "ok"


def test_permission_probe_preserves_files_and_missing_directory(config, tmp_path):
    original = tmp_path / "private.pdf"
    original.write_bytes(b"retained")
    assert pf.storage_check(config).status == "ok"
    assert not config.upload_dir.exists()
    assert list(tmp_path.iterdir()) == [original] and original.read_bytes() == b"retained"


def test_permission_failure_is_safe(monkeypatch, config):
    def fail(*a, **kw):
        raise PermissionError("private filesystem path")

    monkeypatch.setattr(pf.tempfile, "TemporaryFile", fail)
    check = pf.storage_check(config)
    assert check.status == "unavailable" and "private filesystem" not in check.message


@pytest.mark.parametrize(
    "vector,revision,present,expected",
    [
        ("0.8.7", "0004_conversations", True, "ok"),
        (None, "0004_conversations", True, "incompatible"),
        ("0.8.7", "0003_vector_indexing", True, "incompatible"),
        ("0.8.7", "0004_conversations", False, "incompatible"),
    ],
)
def test_database_compatibility_is_read_only(
    monkeypatch, config, vector, revision, present, expected
):
    engine = MagicMock()

    def query(statement, *args):
        sql = str(statement)
        assert sql.startswith(("SELECT", "SHOW"))
        result = MagicMock()
        result.scalar_one.return_value = 170011 if sql.startswith("SHOW") else present
        result.scalar_one_or_none.return_value = vector
        result.scalars.return_value.all.return_value = [revision]
        return result

    engine.connect.return_value.__enter__.return_value.execute.side_effect = query
    monkeypatch.setattr("app.db.session.build_engine", lambda _: engine)
    assert pf.database_check(config).status == expected
    engine.dispose.assert_called_once()


def test_database_failure_does_not_print_driver_details(monkeypatch, config):
    engine = MagicMock()
    engine.connect.side_effect = OSError("postgresql://private-secret@private-host")
    monkeypatch.setattr("app.db.session.build_engine", lambda _: engine)
    check = pf.database_check(config)
    assert check.status == "unavailable" and "private-secret" not in check.message
    engine.dispose.assert_called_once()


@pytest.mark.parametrize(
    "node,version,installed,expected",
    [
        (False, None, False, "missing"),
        (True, "v20.0.0", False, "missing"),
        (True, "v24.16.0", False, "ok"),
        (True, "v24.16.0", True, "ok"),
    ],
)
def test_frontend_runtime_and_missing_packages(
    monkeypatch, config, node, version, installed, expected
):
    monkeypatch.setattr(pf.shutil, "which", lambda _: "node" if node else None)
    monkeypatch.setattr(
        pf,
        "run_command",
        lambda args, **kw: version if "--version" in args else ("" if installed else None),
    )
    monkeypatch.setattr(
        pf, "service_check", lambda *a, **k: pf.Check("frontend", "not_running", "Free")
    )
    monkeypatch.setattr(pf, "writable_directory", lambda _: True)
    monkeypatch.setenv("VITE_API_BASE_URL", "http://localhost:8000")
    checks = pf.frontend_checks(config)
    assert checks[0].status == expected
    if expected == "ok":
        assert checks[1].status == ("ok" if installed else "missing")


@pytest.mark.parametrize(
    "value", ["http://user:private@localhost:8000", "http://localhost:9999", "invalid"]
)
def test_frontend_configuration_failures_are_redacted(monkeypatch, config, value):
    monkeypatch.setenv("VITE_API_BASE_URL", value)
    monkeypatch.setattr(pf.shutil, "which", lambda _: None)
    monkeypatch.setattr(
        pf, "service_check", lambda *a, **k: pf.Check("frontend", "not_running", "Free")
    )
    report = pf.Report(pf.frontend_checks(config))
    assert not report.ready and value not in report.render()


def test_preflight_returns_safe_config_failure_without_service_calls(monkeypatch):
    monkeypatch.setattr(pf, "runtime_checks", lambda: [pf.Check("python", "ok", "Available")])
    from app.core.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("BACKEND_PORT", "private-invalid-value")
    try:
        report = pf.preflight()
        assert not report.ready and "BACKEND_PORT" in report.render()
        assert "private-invalid-value" not in report.render()
    finally:
        get_settings.cache_clear()
