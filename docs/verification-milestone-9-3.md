# Stage 9.3 verification — Reliability Essentials

Implementation and final publication review completed locally on **29 October 2026**,
based on published `b31533ca6877aaab056a23d3b237338b494f4e0e` (Stage 9.2).
Stage 9.3 publication was explicitly approved. The checks below support the approved
commit and normal main-only push. Remote CI must still be checked for the resulting
exact commit; local success does not imply CI success. Milestone 10 has not begun.

## Review and demonstrated gaps

Reviewed every file in the 15-file inventory below, together with existing health
checks, Docker configuration, startup scripts, database/session lifetimes, file
persistence, service clients, processing/indexing admission, persistent conversations
and cancellation cleanup.

Existing mechanisms already provide bounded PostgreSQL/Ollama calls, connection
pre-ping, sanitized failures, independent dependency health, liveness probes,
processing/indexing/chat admission, parser timeouts, leases, idempotency and resource
cleanup. These mechanisms were preserved rather than replaced with infrastructure.

The focused implementation addresses these gaps:

1. Application logs had no request correlation. Requests now receive a generated ID
   linking sanitized request, operation and dependency events, returned through
   `X-Request-ID`. Incoming IDs are ignored. The configured browser origin can read
   the response header; no authentication or trust is attached to the value.
2. Default access logs could retain private URL/query data. A synthetic query canary
   appeared in the original static Nginx access log. Static access logging is now
   disabled. The standard backend entrypoint disables raw Uvicorn access lines;
   structured request completion uses framework route templates or `unmatched`.
3. Processing/indexing lacked elapsed diagnostics. Admitted successful/failed attempts
   now emit fixed operation names, outcomes and milliseconds after releasing slots.
   Search emits elapsed diagnostics. Existing retrieval, generation and citation
   response timings are logged without changing their calculation, context limits,
   evidence selection, prompt-injection protection or citation safeguards.
4. SQL/file storage lacked an executable paired-backup helper and demonstrated
   recovery procedure. A stdlib-only explicit host CLI now validates originals against
   database references, creates a logical dump and copies PDFs into new local output.
   Restoration remains an explicit documented procedure, tested on fresh isolated
   targets only. No automatic/in-place restore command was added.

No new dependencies, models, migrations, RAG tuning, authentication, metrics service,
frontend redesign, background backup or automatic service-reset policy were added.
Publication review required documentation updates only; application implementation
remained unchanged after its prior local verification.

## Logging, correlation and measurement behavior

See [local operations/recovery](operations-recovery.md) for exact fields and commands.
Request events include UTC timestamp, level, generated ID, method, static route
pattern, HTTP status and elapsed milliseconds. Operation events use fixed names,
outcomes and elapsed milliseconds. These diagnostics do not serialize passwords,
request bodies, entire prompts, conversation bodies, PDF contents, filenames, raw
URLs/query strings, client addresses or arbitrary exception/extra payloads.

Correlation allocates one generated 32-character ID and a context token per active
request, resets in `finally` on completion/exception/cancellation and maintains no
registry, cache or growing list of IDs. Concurrent context isolation is tested.
Supplied client identifiers cannot select the correlation value. Unique IDs are
log correlation values, not metric labels or persisted document identifiers.

The reviewed message call sites are static/sanitized. Regression tests cover private
URL/query/body canaries, hostile supplied IDs, 404/422 and security rejection paths,
CORS header exposure, numeric timing and sensitive-exception/extras exclusion.
Live captured API logs also excluded synthetic question/header/filename/content
canaries. Nginx raw query logging was present before the fix and absent afterward.

These are application diagnostics, not a universal third-party traceback scrubber.
Direct Uvicorn invocations need `--no-access-log`; HTTP/SQL debug logging is unsuitable
for private data. Unexpected third-party tracebacks/operator tools still need private
handling. Unhandled server-generated 500s outside middleware may lack the ID header.
HTTP status reflects response headers, not proof of full client receipt after a
stream abort. Local stdout retention/rotation is operator-managed.

Processing/indexing timings cover admitted attempts through cleanup/slot release;
search covers its admitted execution. Busy requests have request status/duration,
without an invented operation time. `completed` means the operation returned, not
that extraction found useful text or that an answer is correct. Completed RAG
responses log existing retrieval/generation/citation times; zero generation can mean
no generation was attempted. Failed RAG stages have request status/duration rather
than fabricated stage times. Provider/network time is included in generation timing.
No exporter, metrics store, dashboard, distributed tracing or latency SLA is introduced.

## Backup coordination, failure safety and restore boundaries

The full procedure is in [operations-recovery.md](operations-recovery.md). The host
helper runs only on explicit `create` or `verify` invocation. It never starts/stops
services, changes `.env`, restores data, overwrites output or deletes recovery evidence.

- Creation requires a new local output ending in `.ragvault-backup`, separate from
  uploads, and explicit `--writers-stopped`. All API instances, workers and external
  database/file writers must actually be stopped by the operator. The flag is an
  acknowledgment, not an automatic lock or writer detector.
- PostgreSQL 17/schema `0004_conversations` are checked. The container's local server
  socket is selected explicitly rather than an inherited remote PGHOST.
- Every original must match database storage key, checksum and size. Missing, orphan,
  redirected and pending staging/quarantine files cause refusal. Before/after
  six-table digests and PDF inventory detect common source changes.
- A custom-format `pg_dump` includes schema, pgvector, application records and Alembic
  revision. Ownership/ACLs are omitted. `.env`, credentials/roles/passwords, Ollama
  models, logs and Docker volume internals are outside this logical backup.
- Output is sensitive: originals, extracted text, vectors, questions, answers and
  citations are included. New POSIX directories/files use 0700/0600 (tested in Linux).
  Windows inherits parent ACLs; operators must choose private storage and verify ACLs.
  Backups/dumps are Git-ignored. Encryption, off-device copies and retention are
  operator-managed. Avoid shared/cloud-synced locations for real backups.
- Failed dump/source-consistency checks leave no complete manifest. Malformed,
  incomplete, unexpected or corrupted output fails verification. Failed operations
  can leave sensitive incomplete files; the CLI withholds raw subprocess details and
  does not print success. A manifest alone is not proof of successful recovery.
- SHA-256 detects accidental byte corruption, not an attacker replacing both archive
  and manifest. Row MD5 summaries are consistency checks, not signatures. Aggregate
  checks need capacity planning for larger databases.

**This is not an atomic online-backup system.** PostgreSQL's snapshot cannot make a
SQL/filesystem transaction. Stopped writers are an operator guarantee; before/after
checks cannot detect every transient concurrent mutation. See PostgreSQL's
[SQL dump documentation](https://www.postgresql.org/docs/17/backup-dump.html).

There is no automated in-place restore. Only trusted backups should be restored:
dumps can execute source-superuser-controlled code. The runbook targets fresh empty
PostgreSQL storage and a new upload directory, prohibits original mounts and destructive
restore options, and requires explicit identity/emptiness/schema/data validation.
See [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
No real-data backup, original-environment restore or cutover was performed.

## Repeat isolated recovery and resource drill

Created uniquely named label-verified source/restore PostgreSQL containers and
API/proxy containers on a disposable network. No original volume or upload directory
was mounted. Disposable container-layer PGDATA survived restart; the default image
data path was masked with tmpfs to avoid anonymous persistent volumes. This is a
test-isolation technique, not recommended long-term database storage. Only exact
owned containers/network were removed afterward. Synthetic outputs remain local and
Git-ignored; no disposable drivers, uploads or backups are published.

1. Uploaded a synthetic two-page garden PDF, processed it, indexed with the installed
   embedding model and generated a saved grounded answer using real Gemma. At least
   one claim passed citation checks, the expected pruning answer appeared and source
   state was available. This is smoke evidence, not an accuracy benchmark.
2. Stopped the owned API gracefully (exit **0**). Explicit paired backup/verification
   took **4,829 ms** in the publication drill. SQL/PDF snapshots matched before/after.
3. Required **zero public tables** in a fresh owned target. Restored with
   `pg_restore --exit-on-error --single-transaction --no-owner --no-privileges`, then
   copied originals only into its new empty upload directory. No reset, `--clean`,
   `--create` or original-volume operation was used.
4. All **six table digests**, original PDF bytes, checksums and metadata matched.
   Restarted the restored database/API and rechecked original download integrity,
   processing/indexing states, saved two-message conversation, available historical
   citations and duplicate request-key idempotency.
5. Real scoped search still returned the expected watering passage on page 2 without
   outside-document hits. Alembic current/check passed. The actual backend Docker
   HEALTHCHECK reached **healthy** after restart.

Publication real-answer timings: retrieval **220.22 ms**, generation **10,892.31 ms**,
citation validation **17.91 ms**, total **11,131.83 ms**. All six operation timing
names appeared in diagnostics. These are individual observations under verification
load, not latency percentiles or an AI correctness guarantee.

| Failure/recovery check | Actual publication result |
| --- | --- |
| Owned PostgreSQL stopped | Health/library HTTP 503 with sanitized errors; liveness 200. Health plus liveness **2,632.77 ms**. |
| Same PostgreSQL restarted | Existing API/pool recovered without API restart; metadata, history, sources, scoped search and idempotency passed again. |
| Disposable Ollama proxy returns HTTP 503 | Health/search 503, library 200; health plus liveness **18.78 ms**. Host Ollama stayed running and unchanged. |
| Ollama proxy restored | Same API recovered. This exercises real HTTP/provider failure handling, not a host Ollama process restart. |
| Owned FastAPI stopped | Exit 0 and unreachable within a **2-second** client timeout. Windows/Docker may report a connect timeout rather than immediate refusal. |
| Live development launcher | One owned API started on loopback; second invocation reused it and exited 0 without adoption. SIGINT stopped only the first launcher's child; exit 0, port closed and lifespan shutdown logged. |
| Startup negative paths | Occupied listener remained alive; invalid configuration and unavailable PostgreSQL/Ollama blocked startup safely. Missing-dependency/ownership cleanup regression tests also passed. |
| Download cancellation | **5** aborted 4 MiB synthetic downloads, deletion 204 each, safe repeat 404, no quarantine leftovers. Open descriptors **14 to 15**, within bounded connection allowance. This is not an endurance/memory proof. |

## Complete available verification — publication replay

| Check | Actual result |
| --- | --- |
| Linux backend suite | **444 passed**, 21 PostgreSQL tests deselected, **70.80 s**. All **24** added reliability cases included; prior baseline was 420. |
| Native Windows backend suite | **442 passed**, **2 skipped**, 21 PostgreSQL tests deselected, **258.20 s**. Skips: privileged native symlink creation and POSIX permission assertions. |
| Separate PostgreSQL/pgvector suite | **21 passed**, 444 deselected, **27.62 s**, in disposable schemas/storage; fresh migrations, current and schema checks passed. |
| Frontend suite | **288 passed** across 22 files. Existing network/degraded-health/retry behavior remains covered. |
| Backend quality | Ruff lint/format passed for **80 Python files**; native and Linux container `pip check` passed. |
| Frontend quality/dependencies | ESLint, Prettier, TypeScript and `npm ls --depth=0` passed. |
| Production build | Passed, including local PDF.js worker/font assets. |
| Compose and Docker builds | Quiet Compose validation and all three image builds passed. |
| Original schema, read-only | `0004_conversations (head)` and `No new upgrade operations detected`. No migration executed on original records. |
| Fresh/restored schema | Migrations to 0004, current/check and PostgreSQL/pgvector compatibility passed. |
| Backend container smoke | Startup, genuine dependency health, synthetic PDF/process/index/search/chat/source recovery, graceful shutdown/restart and actual HEALTHCHECK passed. |
| Slim Nginx smoke | Syntax, Dashboard/Documents/Search/Chat SPA routes, JS, exact worker/font bytes and libxml2 absence passed. Query access logging stayed disabled. |

During initial implementation, Windows imports failed under Application Control for
SQLAlchemy's optional compiled module and Linux verification was used. During this
publication session, native SQLAlchemy/PyMuPDF imports were available and the complete
Windows suite above executed. **No system security policy was changed or bypassed.**
Do not infer permanent native availability from a past session either way. Native
Linux workstation startup is still not fully established; the existing Windows
Ctrl+C wrapper exit-code limitation remains documented in Stage 9.1.

Known warnings: existing Starlette TestClient HTTPX deprecation and PostgreSQL
harness marker warnings. No failing test was suppressed. The first copied disposable
shell harnesses had Windows line endings and failed before checks ran; normalizing
only those ignored harnesses to LF fixed execution without changing application code.

## Container security and deployment boundary

Repeat unfiltered Scout scans retained the existing records; no finding was ignored:

| Image | Current advisory records |
| --- | --- |
| Backend | **37**: 7 high, 3 medium, 27 low |
| Frontend | **1** unspecified musl record |
| PostgreSQL | **73**: 4 critical, 31 high, 29 medium, 7 low, 2 unspecified |

[Stage 9.2's recorded applicability assessment](verification-milestone-9-2.md) remains
in force: compiler/BOM severity differs from reachable vulnerable symbols. Linked
XML, disputed zlib range, pip-vendored urllib3 installer risk, local gosu parser
advisory and musl backport/scanner discrepancy remain documented. No image/dependency
upgrade or suppression occurred here. These are not vulnerability-free containers.

Deployment remains **local-first, trusted and single-user**, with loopback publishing.
There is no authentication and no approval for unrestricted internet exposure or an
unreviewed proxy. Existing context/retrieval/answer-quality limitations and citation
safeguards remain. Word/source checks do not establish factual AI accuracy.

## Privacy and preservation

Fresh read-only baselines cover `.env` and every original data-file hash, six-table
counts/digests (collections, documents, chunks, embeddings, conversations, messages),
cluster identity, original container identity/mounts, Ollama model identities and
protected Git refs. All matched the implementation baseline and the fresh publication
baseline after testing. Original processing/indexing states and stored citation data
are included in those digests. No original PDF, record, conversation, model, volume
or existing commit was modified. The original PostgreSQL container stayed healthy.

Prepublication scans cover **260 candidate files**, **17 existing main commits** and
**470 history blobs** for configured secrets (including encoded forms), private keys,
tokens, personal Windows paths and private-email patterns. Final results are checked
before staging and again on the exact committed history before push. Generated
paths are ignored; **168 other application/configuration files** match HEAD.
Pattern scans are useful evidence, not a mathematical proof of absence.

Backup archives, dumps, real documents, configuration, synthetic uploads, temporary
scripts, raw logs, scanner output and private captures are excluded from publication.
Disposable verification files remain under Git-ignored `.artifacts` only.

## Complete intended/published inventory (15 files)

- `.gitignore` — sensitive backup output exclusions.
- `README.md` — operations/recovery links and deployment boundary.
- `backend/app/__main__.py` — disable raw access URLs in standard entrypoint.
- `backend/app/backup.py` — explicit local create/verify helper; no restore command.
- `backend/app/core/logging.py` — request correlation and sanitized timing diagnostics.
- `backend/app/main.py` — diagnostics middleware and CORS response-header exposure.
- `backend/app/services/indexing.py` — admitted-attempt elapsed diagnostic.
- `backend/app/services/processing.py` — admitted-attempt elapsed diagnostic.
- `backend/app/services/rag.py` — log existing timings; safeguards unchanged.
- `backend/app/services/search.py` — admitted-search elapsed diagnostic.
- `backend/tests/test_backup.py` — refusal/corruption/consistency/privacy regressions.
- `backend/tests/test_reliability.py` — correlation/isolation/rejection/privacy cases.
- `frontend/nginx.conf` — disable default static-server access logging.
- `docs/operations-recovery.md` — runbook and v1.0 operational acceptance criteria.
- `docs/verification-milestone-9-3.md` — this verification record.

## Remaining limitations and acceptance

- Offline backup needs exclusive stopped writers; no SQL/filesystem atomic snapshot,
  automatic repair, retention/encryption service or automatic/in-place restore.
- Disk-full/power-loss endurance, hostile-storage races, large-data capacity and
  off-device recovery are not established by this focused drill.
- Real cutover has not been performed or authorized. Rehearse private storage/ACLs,
  trusted backups and persistent target mounts before relying on recovery.
- Windows ACL/symlink behavior differs from POSIX. Native Linux workstation startup
  remains incompletely tested; Windows Ctrl+C wrapper caveats remain documented.
- Local stdout rotation/capacity is operator-managed; unexpected third-party traces
  need private handling. No distributed tracing, latency SLA or AI accuracy guarantee.
- Unresolved container advisories, trusted-storage boundaries and single-user/no-auth
  deployment restrictions remain as documented.

Use the [v1.0 operational acceptance checklist](operations-recovery.md#recommended-v10-operational-acceptance)
before a real release. Publication is limited to the reviewed 15 files, one normal
main-only update, no tags/backup/recovery refs and no history rewrite. Check the
resulting exact commit in [GitHub Actions](https://github.com/Amrincode/ragvault/actions/workflows/ci.yml)
after push; its actual run URL/conclusions are reported with the published commit.
No public application deployment or Milestone 10 work is included.
