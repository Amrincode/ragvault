import json
import subprocess
from unittest.mock import MagicMock

import pytest

from app import dev
from app.core.config import Settings
from app.preflight import Check, Report


@pytest.fixture
def report(tmp_path):
    settings = Settings(_env_file=None, postgres_password="test", upload_dir=tmp_path / "uploads")
    return Report([Check("configuration", "ok", "Ready")], settings)


def test_repeated_start_reuses_services_without_adopting_processes(monkeypatch, report):
    monkeypatch.setattr(dev, "service_check", lambda *a, **k: Check("service", "ok", "Existing"))
    launch = MagicMock()
    monkeypatch.setattr(dev, "launch", launch)
    stop = MagicMock()
    monkeypatch.setattr(dev, "stop_owned", stop)
    assert dev.start(report) == dev.start(report) == 0
    launch.assert_not_called()
    stop.assert_not_called()


def test_port_conflict_never_kills_or_starts_a_process(monkeypatch, report):
    monkeypatch.setattr(dev, "service_check", lambda *a, **k: Check("fastapi", "conflict", "Busy"))
    launch = MagicMock()
    monkeypatch.setattr(dev, "launch", launch)
    assert dev.start(report) == 1
    launch.assert_not_called()


def test_failed_preflight_or_production_mode_cannot_launch(monkeypatch, report):
    launch = MagicMock()
    monkeypatch.setattr(dev, "launch", launch)
    assert dev.start(Report([Check("database", "unavailable", "Stopped")])) == 1
    report.settings = report.settings.model_copy(update={"app_env": "production"})
    assert dev.start(report) == 1
    launch.assert_not_called()


@pytest.mark.parametrize("interrupted", [False, True])
def test_failed_or_interrupted_start_cleans_only_owned_handle(monkeypatch, report, interrupted):
    monkeypatch.setattr(
        dev, "service_check", lambda *a, **k: Check("fastapi", "not_running", "Free")
    )
    owned = MagicMock()
    monkeypatch.setattr(dev, "launch", lambda *a: owned)

    def ready(*args):
        if interrupted:
            raise KeyboardInterrupt
        return False

    monkeypatch.setattr(dev, "wait_ready", ready)
    stop = MagicMock()
    monkeypatch.setattr(dev, "stop_owned", stop)
    assert dev.start(report, backend_only=True) == (0 if interrupted else 1)
    stop.assert_called_once_with(owned)


def test_frontend_setup_failure_releases_owned_backend(monkeypatch, report):
    monkeypatch.setattr(
        dev, "service_check", lambda *a, **k: Check("service", "not_running", "Free")
    )
    owned = MagicMock()
    monkeypatch.setattr(dev, "launch", lambda *a: owned)
    monkeypatch.setattr(dev, "wait_ready", lambda *a: True)
    monkeypatch.setattr(dev.shutil, "which", lambda _: None)
    stop = MagicMock()
    monkeypatch.setattr(dev, "stop_owned", stop)
    assert dev.start(report) == 1
    stop.assert_called_once_with(owned)


def test_owned_exit_cleans_owned_sibling_and_never_adopts_existing_api(monkeypatch, report):
    monkeypatch.setattr(
        dev,
        "service_check",
        lambda name, *a, **k: Check(name, "ok" if name == "fastapi" else "not_running", "Ready"),
    )
    monkeypatch.setattr(dev.shutil, "which", lambda _: "node")
    monkeypatch.setattr(dev, "run_command", lambda *a, **k: "")
    owned = MagicMock()
    owned.poll.return_value = 0
    launch = MagicMock(return_value=owned)
    monkeypatch.setattr(dev, "launch", launch)
    monkeypatch.setattr(dev, "wait_ready", lambda *a: True)
    stop = MagicMock()
    monkeypatch.setattr(dev, "stop_owned", stop)
    assert dev.start(report) == 1
    assert launch.call_count == 1 and launch.call_args.args[0][0] == "node"
    assert "--strictPort" in launch.call_args.args[0]
    stop.assert_called_once_with(owned)


def test_launch_uses_no_shell_or_reload_supervisor(monkeypatch, tmp_path):
    popen = MagicMock()
    monkeypatch.setattr(dev.subprocess, "Popen", popen)
    dev.launch(["python", "-m", "app"], tmp_path)
    assert popen.call_args.args == (["python", "-m", "app"],)
    assert "shell" not in popen.call_args.kwargs
    assert "--reload" not in popen.call_args.args[0]


def test_stop_owned_is_idempotent_for_exited_process():
    process = MagicMock()
    process.poll.return_value = 0
    dev.stop_owned(process)
    process.send_signal.assert_not_called()
    process.terminate.assert_not_called()


def test_safe_shutdown_sends_graceful_signal_first():
    process = MagicMock()
    process.poll.return_value = None
    dev.stop_owned(process)
    process.send_signal.assert_called_once()
    process.wait.assert_called_once_with(timeout=10)
    process.terminate.assert_not_called()


def test_shutdown_fallback_targets_only_owned_process():
    process = MagicMock()
    process.poll.return_value = None
    process.send_signal.side_effect = OSError("No console")
    process.wait.side_effect = [subprocess.TimeoutExpired("owned", 5), 0]
    dev.stop_owned(process)
    process.terminate.assert_called_once()
    process.kill.assert_called_once()


def test_readiness_stops_when_child_exits(monkeypatch):
    process = MagicMock()
    process.poll.return_value = 1
    monkeypatch.setattr(dev, "service_check", lambda *a, **k: pytest.fail("Child already exited"))
    assert not dev.wait_ready("fastapi", "http://localhost:8000", process, "development")


def test_json_command_exit_and_redaction(monkeypatch, report, capsys):
    monkeypatch.setattr(dev.sys, "argv", ["dev", "preflight", "--json"])
    monkeypatch.setattr(dev, "preflight", lambda **k: report)
    assert dev.main() == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload == {
        "ready": True,
        "checks": [{"name": "configuration", "status": "ok", "message": "Ready", "required": True}],
    }


def test_unexpected_diagnostic_exception_is_redacted(monkeypatch, capsys):
    monkeypatch.setattr(dev.sys, "argv", ["dev", "preflight"])

    def fail(**kwargs):
        raise OSError("private-path-with-credentials")

    monkeypatch.setattr(dev, "preflight", fail)
    assert dev.main() == 1
    assert "private-path" not in capsys.readouterr().out
