# Local operations and paired recovery

RAGVault supports a trusted, local-first, single-user workstation. Bind published
ports to loopback. Do not expose the API, Ollama or PostgreSQL to the internet or
add an unreviewed reverse proxy. Origin/Host checks are not authentication. Existing
container advisories and deployment restrictions remain in
[Stage 9.2 verification](verification-milestone-9-2.md).

## Health, diagnostics and service recovery

- `/` is application liveness; the backend Docker health check uses this endpoint.
  `/api/health` reports database/Ollama readiness independently: HTTP 503 describes
  degraded dependencies without making a healthy API restart repeatedly.
- Structured application logs include UTC time, level and static messages. Requests
  receive a server-generated `X-Request-ID`, exposed to the configured browser
  origin. Supplied IDs are ignored. Dependency/error and operation logs inside the
  request share its context. Correlation is per request, not persistent tracing.
- Completion logs use route templates, method, status and elapsed milliseconds.
  Unknown paths are `unmatched`. These diagnostics do not collect raw URLs/query
  strings, client IPs, headers, bodies, filenames, excerpts, questions, answers or
  credentials. The standard entrypoint disables Uvicorn's raw access log. If
  launching Uvicorn directly, use `--no-access-log`; do not enable HTTP/SQL debug
  dumps. Unexpected third-party tracebacks and operator tools still require private
  handling; the new diagnostics are not a universal third-party log scrubber.
  HTTP status describes response headers, not proof a client received a full file.
  Unhandled server-generated 500 responses outside middleware may lack the ID header.
- Processing/indexing measure admitted attempts through cleanup/slot release; search
  measures its admitted execution. `completed` means the operation returned, not
  that a document has useful text or that an AI answer is correct. Busy requests
  have request status/duration without inventing a processing duration. Completed
  RAG responses log the existing retrieval, generation and citation-check times.
  Generation includes provider/network time; citation timing includes source checks.
  A zero generation time can mean generation was not attempted. Failed RAG stages
  have request status/duration, not fabricated stage measurements.
- No exporter, metrics store or dashboard is installed. Unique request IDs are log
  correlation values; never use them as metric labels. Local stdout retention and
  rotation remain the operator's responsibility. The static Nginx server disables
  per-request access logging to avoid retaining raw query/referrer data.

On failure, inspect redacted health/diagnostics. Start the **existing** database
container or Ollama if stopped. Check installed models without automatically pulling
anything. Retry after readiness recovers. Do not reset the database to fix
connectivity. Ambiguous writes/disk errors may require offline reconciliation.

The development launcher reuses recognized services and stops only process handles
it created. Windows Ctrl+C wrapper exit code can be 1 despite successful owned-child
cleanup; see [Stage 9.1](verification-milestone-9-1.md). Native Linux workstation
startup is not fully tested. Container SIGTERM/restart tests do not establish that
coverage. No new automatic Docker restart/recovery policy has been introduced.

## Explicit paired backup

Only run this when an operator requests a local backup. There is no scheduled or
startup backup. Backups contain original PDFs, extracted text, embeddings, questions,
answers and citations. Treat the **entire directory**, including the manifest, as
sensitive. New POSIX directories/files use 0700/0600; Windows inherits parent ACLs.
Choose private local storage and verify Windows ACLs; avoid shared/cloud-synced
folders. Encryption, off-device copies and retention are operator-managed.

1. Finish active operations. Stop **all** native/Docker API instances, workers and
   external SQL/file writers; leave PostgreSQL running. Do not kill unrelated
   processes. A launcher does not stop services it reused.
2. Identify the actual PostgreSQL container and configured host upload directory.
   Defaults below are examples, not detection of a custom `.env`. Use the current
   database/image/role. The helper reads existing container database/user variables
   over its local socket and never prints them or reads `.env`.
3. Select a **new** output ending in `.ragvault-backup`. Its private parent must
   already exist. From the checkout root with Python 3.12+ and Docker CLI:

   ```powershell
   python backend/app/backup.py create --container ragvault-postgres-1 --uploads C:\Projects\ragvault\data\uploads --output C:\PrivateBackups\manual.ragvault-backup --writers-stopped
   python backend/app/backup.py verify --output C:\PrivateBackups\manual.ragvault-backup
   ```

   This stdlib helper runs on the host; the API image has no Docker CLI. It does
   not import SQLAlchemy. Never put passwords in commands. `.ragvault-backup/`,
   `backups/` and `*.dump` are Git-ignored; never force-add backup contents.
4. The helper checks PostgreSQL 17/schema `0004_conversations`, matches original
   checksum/size/storage keys to metadata, rejects missing/orphan/redirected files
   and nonempty `.tmp`/`.trash`, copies originals and makes a custom `pg_dump`
   without ownership/ACLs. Six-table row digests/PDF inventory are compared before
   and after; a manifest is written and SHA-256 checked. Existing output is never
   overwritten or deleted. Failure may leave **sensitive incomplete output**.
   No manifest means incomplete; a manifest alone is insufficient without successful
   verification. Reconcile offline and retry a different new output. The helper
   never deletes recovery evidence automatically.
5. Resume writers after success or an explicit decision to abandon the attempt.
   Record the trusted application revision, image/version details and model
   identities separately. Store credentials separately and privately. `.env`,
   roles/passwords, Ollama models, logs and volume internals are not in this logical
   backup. Do not mistake an untested backup for proven recovery.

`pg_dump` gives an internally consistent SQL snapshot, not a SQL/filesystem
transaction. **Stopped writers are an operator guarantee**: the flag does not detect
or stop writers. Before/after checks detect common changes, not every transient
concurrent mutation. Row MD5 digests are consistency checks, not signatures.
SHA-256 detects accidental corruption, not an attacker replacing both backup and
manifest. Aggregate checks need memory/capacity planning for larger databases.
See PostgreSQL's [SQL dump documentation](https://www.postgresql.org/docs/17/backup-dump.html).

## Restore into a fresh isolated target first

There is deliberately **no restore subcommand** or automatic in-place recovery.
Never restore into the original cluster/uploads as a test. Do not use `--clean`,
`--create`, `DROP`, `down -v` or volume-prune commands here. Only restore trusted
backups: a dump can execute source superuser-controlled code. See
[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

1. Verify the trusted backup. Provision uniquely named fresh PostgreSQL 17 storage
   using the **same compatible image/pgvector version and locale/collation**, a new
   private upload directory and isolated network. Do not mount the original volume
   or publish on its port. Supply credentials privately. Review target identity,
   mounts, database name and emptiness. The drill used disposable container-layer
   PGDATA retained across restart, with no original volume. This is a test technique,
   not long-term storage. Real cutover needs a separately provisioned persistent
   target with its mounts explicitly reviewed.
2. On the fresh target, require
   `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`
   to return zero. **Do not migrate/create tables first**: the dump contains schema,
   extension and Alembic revision.
3. Copy the dump into that reviewed target. This example is **only for a verified
   fresh target**, never the original container:

   ```powershell
   docker cp C:\PrivateBackups\manual.ragvault-backup\database.dump ragvault-restore-check:/tmp/recovery.dump
   docker exec ragvault-restore-check sh -c 'exec pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/recovery.dump'
   ```

   Do not use `--create` to select the archived database name. Stop on errors.
   Ownership/ACLs are deliberately not restored; the target role is created
   separately for this single-user procedure.
4. Copy backup `uploads` into the **new empty** directory only. Keep storage-key
   filenames/bytes. Set restrictive POSIX permissions or Windows ACLs before API
   use. Do not copy live staging/quarantine leftovers. Compare checksums/sizes to
   restored metadata and reject missing/orphan files. Compare the local result of
   `app.backup.snapshot(target_container)` with the manifest's `snapshot`, using the
   same session timezone (normally UTC). This result is sensitive; do not publish it.
5. Start a separate API configured for **both restored targets**, without changing
   the real `.env`. Run Alembic `current` and `check`; no upgrade is needed here.
   Verify readiness, original bytes, processing/indexing states, scoped search,
   saved history, source availability and request-key idempotency. Vector reuse
   requires the same model identity; a model change may require deliberate reindexing.
6. Restart the isolated database/API and repeat checks. A later real cutover needs
   separate authorization, stopped writers and the old pair retained for rollback.
   Switching only SQL or only PDFs is not recovery. In-flight leases can require
   expiry and existing retry rules; do not manually rewrite them.

## Recommended v1.0 operational acceptance

- Supported workstation passes preflight, or an approved Docker application workflow
  is used while native Application Control issues are addressed by the operator.
- Loopback-only services, trusted storage/ACLs and no unrestricted internet exposure.
- Full regression/schema/container smoke checks pass; outstanding advisories reviewed.
- Dependency degradation/recovery and owned-process shutdown are understandable.
- Operator has rehearsed paired backup/isolated restore, restart, original source
  bytes, saved history and vector compatibility.
- Private retention, off-device/encryption arrangements, disk capacity and recurring
  restore drills are chosen for the sensitivity and importance of the documents.
- Existing retrieval/context/answer-quality limitations and citation safeguards stay
  visible. Health and wording checks do not guarantee factual AI accuracy.
