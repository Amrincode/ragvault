# Stage 9.1 — configuration and startup reliability

Implemented and verified on **28 October 2026 (Asia/Singapore)**, based on
`ab47ced26039a86c4ebb14fe133fb4b152db1037`. Publication was approved after implementation;
this report includes the final local publication review.
Stage 9.2 and AI intelligence work have not started. This is a local development
workflow, not authorization for public exposure or a production deployment system.

## Review and changes

The existing infrastructure already supplied Pydantic Settings, environment-over-dotenv
precedence, a required SecretStr database password, bounded database connections,
loopback defaults, local Host/Origin protections, liveness and separate dependency
health, explicit migrations, resource disposal, Vite strict ports and local PDF assets.
Compose already retained PostgreSQL in a named volume and could run PostgreSQL alone
while Ollama remained on the host. No startup script existed.

Focused improvements:

- Settings reject blank connection/model fields, malformed bind hosts and Ollama URLs
  containing credentials/query/fragment. Nonblank passwords retain their exact bytes.
  Validation text hides inputs; the cached settings loader raises field-name-only
  diagnostics. The normal API CLI reports configuration failures without a traceback.
- The engine cleanup guard now also covers storage/service initialization. Storage
  failures have a safe permission/symlink diagnostic; partially initialized HTTP clients
  still close through their existing context managers. Startup does not connect to the
  database, create tables, migrate, or recover/delete stored files automatically.
- `python -m app.dev preflight` checks Python 3.12+, backend imports/pip consistency,
  Node/package manifests when frontend is requested, optional Docker/Compose, required
  PostgreSQL/pgvector/current revision/table presence, upload/staging/trash write access,
  Ollama/model listing, existing API health, frontend identity and port conflicts.
- `python -m app.dev start` diagnoses first, rechecks ports immediately before spawn,
  reuses recognized healthy services, prepares local PDF assets and starts only missing
  API/Vite processes. It holds direct process handles in a foreground invocation, with
  bounded readiness and shutdown waits. There are no PID files, background service
  installation, reload supervisors, process-name kills or unrelated-process adoption.
- Thin PowerShell and POSIX wrappers select the repository venv and working directory.
  README adds the workflow without replacing the established manual setup/runbook.

No `.env` rewrite, dependency installation, model pull/switch, automatic Docker launch,
automatic database start/reset, schema change, migration, frontend design change or API
contract change was introduced. `APP_ENV` distinctions, direct API degraded-health
behavior and Docker's explicit container bind remain intact. The native launcher
requires development mode and loopback HTTP origins.

## Commands and setup

Use the existing README setup for a new checkout. Keep an existing `.env`, database
volume, model installation and uploads. Start Docker Desktop/Engine explicitly if
using Compose PostgreSQL; for an already-created container use `docker compose start
postgres`. New database setup and migrations remain explicit runbook operations.
Start host Ollama separately. Preflight never attempts to do those things for you.

Windows, from the repository root:

```powershell
.\scripts\start-dev.ps1 -CheckOnly
.\scripts\start-dev.ps1
```

Or use the venv directly, from `backend`:

```powershell
.\.venv\Scripts\python.exe -m app.dev preflight
.\.venv\Scripts\python.exe -m app.dev preflight --json
.\.venv\Scripts\python.exe -m app.dev preflight --backend-only
.\.venv\Scripts\python.exe -m app.dev start
.\.venv\Scripts\python.exe -m app.dev start --backend-only
```

Linux setup, from the repository root, after installing Python/Node and configuring the
existing dependencies and private `.env` explicitly:

```sh
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e './backend[dev]'
npm --prefix frontend ci
sh scripts/start-dev.sh --check
sh scripts/start-dev.sh
```

Native Linux full-stack startup was **not** executed. The POSIX wrapper was checked
inside the built Linux backend container for shell syntax, root resolution and its
missing-venv guard. That is narrower evidence than a Linux desktop test. Docker's
host-Ollama routing also depends on the host's existing configuration; this stage does
not change Ollama's bind or add network exposure to make it work.

Keep the owning terminal open. Ctrl+C releases only its started application services,
leaving PostgreSQL/Ollama and reused services alone. If both services already run, the
command returns immediately without adopting them; stop those services in their
original terminals. Settings/code changes require an explicit restart. The existing
two-terminal `python -m app --reload` / `npm run dev` workflow is still available.
Readiness is polled for approximately 20 seconds. Shutdown gives an owned child 10
seconds to exit gracefully, then uses bounded terminate/kill fallbacks (5 seconds each).
Finish active uploads or generation before stopping when possible; interrupted active
requests and hard crashes retain the application's existing recovery limitations.

## Diagnostics and boundaries

Preflight exits 0 when required checks pass and 1 when blocked. A free API/frontend
port is `not_running`, an expected launchable state. Optional Docker failures do not
block a reachable compatible external PostgreSQL server. PostgreSQL and configured
models are required for the launcher's complete-workspace workflow; a library-only
session without Ollama can still use the original manual API command.

Sanitized examples (no real settings values):

```text
[STOPPED] docker: Docker CLI is installed; engine is stopped or unreachable.
[UNAVAILABLE] postgresql: Connection or compatibility inspection failed.
[MISSING] chat_model: Configured model is absent.
[CONFLICT] fastapi: Port is occupied by an unrecognized/unresponsive service.
[INVALID] configuration: Missing or invalid configuration: BACKEND_PORT.
```

Actual output includes recovery instructions. Messages do not relay subprocess output,
driver exceptions, DSNs, configured host/model names, document names or filesystem paths.
Subprocess timeouts are 5–20 seconds; HTTP checks use 3-second connect/read timeouts and
a 1 MiB response cap; local port probes use 0.5 seconds. PostgreSQL retains its configured
connect/statement timeouts. Filesystem permission probes create/remove only their own
temporary file, including when checking a missing directory's existing parent.

Database preflight checks revision and expected tables, not every column/index or
permission needed for future writes. `alembic check` remains the explicit schema-drift
check. A model listing establishes availability, not sufficient VRAM, context fit or
answer quality. Package-manifest checks establish presence, not complete dependency
integrity; npm ci/ls, tests and builds remain important. Reused HTTP identity is not
authentication and does not prove the service uses this checkout or identical settings.
Readiness is a point-in-time observation; a dependency can fail afterward.

## Automated verification actually run

| Check | Result |
| --- | --- |
| Complete backend suite | **392 passed, 21 skipped**, 304.69 seconds |
| Separate PostgreSQL/pgvector suite | **21 passed, 392 deselected**, 209.21 seconds |
| Complete frontend suite | **287 passed, 22 files**, 22.60 seconds |
| Targeted startup/configuration rerun at implementation checkpoint | **91 passed**, 3.00 seconds |
| Backend Ruff lint/format | Passed; 76 Python files formatted |
| Backend pip consistency | Passed; no broken requirements |
| ESLint / Prettier / TypeScript | All passed |
| Frontend dependency consistency | npm ls --depth=0 passed |
| npm security audit | 0 vulnerabilities at verification time |
| Production frontend build | Passed; 133 modules, 1.21 seconds |
| Alembic current/check | `0004_conversations (head)`; no new upgrade operations |
| Compose configuration/build | Quiet validation and all three image builds passed |
| Backend container smoke | Liveness 200, PostgreSQL and host Ollama healthy |
| Frontend container smoke | Root, SPA route and actual 17597-byte PDF font passed |
| POSIX wrapper | Linux shell syntax and missing-venv guard passed |
| Windows wrapper | Check-only, reuse and disposable missing-venv guard passed |
| PowerShell syntax / Git whitespace | Parser and git diff --check passed |

All **413 backend cases** ran across ordinary/integration commands; the 21 ordinary
skips are exactly the explicitly enabled PostgreSQL cases. There are **73 added cases**
over the 340-case Milestone 8 suite. New tests cover missing/malformed settings,
environment precedence, redaction, missing imports/packages, optional Docker states,
model presence, offline/malformed services, permissions, revision/table compatibility,
existing service identity, port conflicts, reuse/idempotency, startup interruption,
readiness failure and graceful/fallback cleanup of only owned handles. Lifecycle tests
verify engine disposal after failed storage/client initialization and normal HTTP-client
closure. The existing HTTPX/TestClient deprecation warning remains.

The initial sandboxed lifecycle run blocked in Windows asyncio's socket-pair setup,
before application startup. Rerunning with local socket access passed the lifecycle
checks and the full suites; no networking policy was changed in the application.
An early package probe treated type-only packages as missing runtime modules. Checking
declared manifests fixed that false diagnostic; the real npm consistency/build checks
then passed.

## Live Windows verification

At session start Docker Engine and PostgreSQL were stopped; Ollama was running, while
ports 8000/5173 were free. The standard system-wide Docker Desktop path was absent.
The installed per-user executable was located through the existing CLI installation,
started, and the engine was verified before `docker compose start postgres` started
the existing container. No `up`/recreate/reset/volume-deletion operation was used.
This was operator verification, not behavior added to the launcher.

| Scenario | Observation |
| --- | --- |
| Required services available, applications stopped | Ready; API/frontend reported not_running, not false failures |
| Native startup | API and Vite started on loopback; root/health and frontend returned 200 |
| Existing services and repeated preflight | Passed twice; diagnostics were safe to share |
| Repeated Windows startup | Returned 0 and reused the exact same API/frontend listener PIDs; no duplicates |
| Unreachable database | Process-only unused-port override returned 1 with required PostgreSQL unavailable |
| Unreachable Ollama | Process-only unused endpoint returned 1; no model pull attempted |
| Absent configured chat model | Process-only disposable model name returned 1 with chat_model missing |
| Invalid configuration | Process-only canary returned 1 and the field name only; no canary/secret/path leaked |
| Occupied API port | Disposable unrelated HTTP service stayed running; launch returned 1 with no children |
| Windows missing venv | Disposable checkout returned 1 with actionable text and no personal path |
| Ctrl+C shutdown | Both owned API/frontend ports closed; API logged graceful shutdown; PostgreSQL/Ollama listeners remained |

The terminal's PowerShell host reported exit 1 on Ctrl+C even though the launcher's
interruption path returned through cleanup. Listener and shutdown-log checks, rather
than a claimed zero terminal exit, establish the observed safe shutdown. Windows
console interruption exit codes can depend on the invoking host. Unit tests cover the
Python return/cleanup path and bounded fallback; no hard crash or power-loss recovery
is claimed.

The original application ports were left stopped after shutdown verification, matching
their initial state. PostgreSQL and Ollama remain running. No reused service was stopped
for failure simulation. Failure tests used mocks, process-only settings or a disposable
HTTP listener. Full native Linux/macOS lifecycle and Docker-Desktop auto-start portability
were not tested; the code intentionally does not automate Desktop startup.

## Synthetic end-to-end and preservation

The unchanged real API ran on a separate port with a uniquely owned PostgreSQL schema
and ignored upload location. A disposable three-page garden PDF exercised collection
creation, original-byte download matching, processing, indexing, exact document/collection
search scope and page-2 retrieval. Real local Ollama generated a saved cited answer,
with **2 accepted claims**, source availability and duplicate-request replay preserved.
Retrieval/generation/checks were **141 / 44687 / 32 ms**, total **44860 ms**. This includes
model loading/system load and is an observation, not a new performance guarantee.
No RAG, citation, context, model, persistence or PDF algorithm was changed.

A real follow-up completed with available citations and the original fixed document
scope; four messages persisted. Its retrieval/generation/checks were
**2187 / 11187 / 32 ms**, total **13406 ms**. All synthetic conversation/document/
collection records were then removed, and the original six-table/config/upload/cluster/
mount snapshot matched its baseline. Only the verified-empty owned schema and isolated
API were removed afterward.

Original `.env`/upload hashes, six-table row digests, PostgreSQL cluster identity, volume
mounts and Git refs are compared with private baselines. Disposable fixtures and their
empty schema are removed after verification. Private baseline records, raw logs,
synthetic uploads and helper scripts remain ignored under `.artifacts/m9-1`.

The final privacy audit passed **252 candidate files, 15 existing reachable main commits
and 446 history blobs**, with no configured-secret, token/key, personal-email or
personal-path findings. The exact 13-file inventory excludes generated files and all
temporary helpers. **161 other tracked backend/frontend files** matched their base
objects. The original file/configuration hashes and six-table/cluster/mount snapshots
matched, and the removed QA schema was confirmed absent. No original PDF content or
screenshot is added. Only the inventory below is eligible for publication. No migration
or Git-history rewrite was performed; the approved push updates only main. The exact publication
commit and GitHub Actions result are reported after pushing; local checks alone do
not establish CI success.

No new required environment variables or dependencies were added; `.env.example`,
Compose and CI configuration remain unchanged. The publication inventory contains
6 modified and 7 new intended files. The final review preserves the Windows interruption and native-Linux limitations above.

Existing limitations remain: local single-user use without authentication, heuristic
evidence selection/follow-ups, the 4K context budget, conservative citation wording checks
and potentially incomplete/irrelevant AI answers. Source checks do not prove factual
truth. Stage 9.1 does not claim production readiness or complete WCAG conformance.

## Final publication review

The user approved the Stage 9.1 commit and a normal main-branch push. All 13 files
were reviewed individually. No application correction was necessary; only this report's
publication status and evidence were updated. The automated table above records the
fresh publication runs, apart from the explicitly labelled implementation-only targeted
rerun. All 413 backend cases ran across the two fresh commands.

The Windows PowerShell wrapper started missing API/Vite services on loopback. Repeated
startup returned 0 and preserved the exact listener PIDs. Fresh preflight checks passed
for existing services and repeated execution. Process-only unreachable PostgreSQL and
Ollama endpoints, a missing configured model and invalid-configuration canary produced
safe failures; no setting file or service was changed. A disposable occupied-port
server stayed intact and no application child was started. The disposable missing-venv
guard and PowerShell parser passed. No real dependency was removed for a failure test.

Ctrl+C again closed both owned application listeners and logged graceful API shutdown,
while PostgreSQL/Ollama remained available. The invoking Windows terminal again exited
1, so the documented host-specific interruption caveat is retained. Application ports
were left stopped, matching the publication baseline. Reused services were not adopted
or terminated. The three images rebuilt and their disposable container checks passed;
Linux evidence remains limited to container/application smoke and shell syntax/guard
checks, not a complete native Linux development startup.

A new private baseline confirmed unchanged original uploads/configuration, six-table
row digests, processing/indexing states, cluster identity and volume mounts. The complete
Ollama model name/digest/size list also matched before and after verification. No model
was pulled or changed. No synthetic document/conversation was added in this publication
review; the real-model PDF/follow-up timings above are implementation evidence. The
fresh full regression/integration suites cover the existing workflows.

Privacy checks passed all 252 candidate files and existing reachable main history, and
161 other tracked backend/frontend files matched their base Git objects. Temporary
scripts, logs, baseline records, caches, build output and disposable fixtures remain
ignored. Only the inventory below may enter the commit. The exact commit and GitHub
Actions result are verified after the main-only push and reported with publication.

## Complete changed-file inventory (13 files)

- `README.md`
- `backend/app/__main__.py`
- `backend/app/core/config.py`
- `backend/app/main.py`
- `backend/app/preflight.py`
- `backend/app/dev.py`
- `backend/tests/test_config.py`
- `backend/tests/test_lifecycle.py`
- `backend/tests/test_preflight.py`
- `backend/tests/test_dev.py`
- `scripts/start-dev.ps1`
- `scripts/start-dev.sh`
- `docs/verification-milestone-9-1.md`
