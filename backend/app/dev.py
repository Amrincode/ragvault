"""Foreground dev launcher owning process handles, never PID files or service resets."""

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time

from app.preflight import ROOT, Report, api_url, preflight, run_command, service_check


def stop_owned(process: subprocess.Popen) -> None:
    """Only called with a handle returned by this invocation's Popen."""
    if process.poll() is not None:
        return
    try:
        process.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGTERM)
        process.wait(timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def launch(args: list[str], cwd) -> subprocess.Popen:
    # No shell, reload supervisor, detached daemon or persistent PID file.
    return subprocess.Popen(
        args,
        cwd=cwd,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )


def wait_ready(name: str, url: str, process: subprocess.Popen, environment: str) -> bool:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        if service_check(name, url, environment=environment).status == "ok":
            return True
        time.sleep(0.2)
    return False


def start(report: Report, *, backend_only: bool = False) -> int:
    if not report.ready or report.settings is None:
        return 1
    settings = report.settings
    if settings.app_env != "development":
        print(
            "Development launcher requires APP_ENV=development; test/production "
            "modes are unchanged."
        )
        return 1
    endpoints = [("fastapi", api_url(settings))]
    if not backend_only:
        endpoints.append(("frontend", settings.cors_origin))
    owned: list[subprocess.Popen] = []
    try:
        for name, url in endpoints:
            # Recheck immediately before spawn; a bind race still fails safely in the child.
            check = service_check(name, url, environment=settings.app_env)
            if check.status == "ok":
                print(f"Reusing existing {name}; it will not be stopped by this launcher.")
                continue
            if check.status != "not_running":
                print(f"{name}: {check.message}")
                return 1
            if name == "fastapi":
                command = [sys.executable, "-m", "app"]
                cwd = ROOT / "backend"
            else:
                node = shutil.which("node")
                if (
                    not node
                    or run_command([node, "scripts/copy-pdf-assets.mjs"], cwd=ROOT / "frontend")
                    is None
                ):
                    print(
                        "Could not prepare local PDF assets. Check frontend "
                        "dependencies/permissions."
                    )
                    return 1
                command = [
                    node,
                    "node_modules/vite/bin/vite.js",
                    "--host",
                    "::1" if settings.frontend_origin.host == "::1" else "127.0.0.1",
                    "--port",
                    str(settings.frontend_origin.port or 80),
                    "--strictPort",
                ]
                cwd = ROOT / "frontend"
            process = launch(command, cwd)
            owned.append(process)
            if not wait_ready(name, url, process, settings.app_env):
                print(
                    f"{name} did not become ready. "
                    "Check its port, configuration and service diagnostics."
                )
                return 1
            print(f"Started owned {name} on loopback.")
        if not owned:
            print("All requested services already run. No process started or adopted.")
            return 0
        print(
            "Development services ready. Ctrl+C stops only processes started here; "
            "PostgreSQL/Ollama stay running."
        )
        while all(process.poll() is None for process in owned):
            time.sleep(0.25)
        print("An owned service exited; shutting down the other owned services.")
        return 1
    except KeyboardInterrupt:
        print("Stopping owned development processes.")
        return 0
    except OSError:
        print(
            "Unable to launch a development process. Check runtime/dependency "
            "installation and permissions."
        )
        return 1
    finally:
        for process in reversed(owned):
            stop_owned(process)


def main() -> int:
    parser = argparse.ArgumentParser(description="RAGVault native development diagnostics/startup")
    parser.add_argument("command", choices=("preflight", "start"))
    parser.add_argument(
        "--backend-only", action="store_true", help="Skip Node/frontend checks and launch"
    )
    parser.add_argument(
        "--json", action="store_true", help="Shareable preflight JSON (not for start)"
    )
    args = parser.parse_args()
    if args.json and args.command != "preflight":
        parser.error("--json is only available with preflight")
    try:
        report = preflight(backend_only=args.backend_only)
    except KeyboardInterrupt:
        print("Preflight interrupted; no services started.")
        return 130
    except Exception:
        print(
            "Preflight could not complete. Check configuration permissions and "
            "installed backend dependencies; raw diagnostics are withheld."
        )
        return 1
    print(report.render(json_output=args.json))
    if args.command == "preflight":
        return 0 if report.ready else 1
    return start(report, backend_only=args.backend_only)


if __name__ == "__main__":
    if os.name == "nt":
        signal.signal(signal.SIGBREAK, signal.default_int_handler)
    raise SystemExit(main())
