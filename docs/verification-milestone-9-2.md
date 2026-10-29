# Stage 9.2 — security hardening

Initial assessment completed on **28 October 2026 (Asia/Singapore)**; final container
triage updated on **29 October 2026**, based on
`a231671112966926e98faaec366376b46d5bd1cc`. Final publication was approved on
29 October 2026; the publication review and fresh checks are recorded below.
Stage 9.3, authentication and public deployment are outside this stage.

## Initial threat model (before changes)

Protected assets are original PDFs, extracted chunks, vectors, saved conversations,
database credentials and the integrity/availability of local files and PostgreSQL.
Entry points are browser/API requests, multipart filenames/PDF bytes, questions,
retrieved text, Ollama responses and the configured storage directories.

| Boundary / attacker | Existing mitigation | Residual risk and assessment priority |
| --- | --- | --- |
| Malicious website → loopback API | Exact write-Origin allowlist, narrow CORS, local Host allowlist; loopback binds | Browser rules are not authentication. No-Origin/native clients can access the API. Test CORS/Host/protocol behavior without claiming all local requests are blocked. |
| Another network host → services | Native API/Vite and Compose published ports default to loopback | Explicit operator configuration, trusted Docker networks, proxies/forwarding and host compromise remain outside this boundary. No public binding will be enabled. |
| Local process → API | Bounded inputs, transactions, parser/index/chat admission controls | Without authentication, an untrusted local HTTP client can read/change data and forge Origin/Host. This is high residual risk on a shared/untrusted host, requiring architecture changes before broader exposure. No authentication is added here. |
| API → filesystem | UUID storage keys, canonical path checks, isolated staging/trash, rollback, bounded parser subprocesses | Verify runtime directory replacement, file-handle errors, new-file permissions and cleanup. A malicious actor controlling the service account/storage can still race or directly change files. |
| API → PostgreSQL | SQLAlchemy parameterized queries, UUID filters, locks/transactions, connection/statement timeouts | Service credentials authorize the existing app operations. The database and Docker bridge are trusted, not separate tenants. No schema changes or resets are planned. |
| PDF/question → model | Evidence delimiters, fixed scope, bounded context, no tools, extractive selections, citation/source rechecks | Prompt injection can affect answer quality; heuristic wording checks do not prove truth. Document text has no filesystem/SQL/network tool authority. Preserve prompts/models/citation rules. |
| PDF/excerpts → frontend | React text rendering, local PDF.js canvas, backend-generated source URLs | Downloaded original PDFs remain untrusted files; structural PDF validation is not malware scanning. Verify escaped rendering and no automatic execution/navigation. |

Initial candidates were recorded before changes: non-chat JSON body-limit gaps,
validation-input reflection, runtime staging/trash redirection, concurrent upload parser
admission and setup-time download handle cleanup. The results below distinguish the
reproduced failures from assumptions. No authentication or general-purpose rate limiter
was added.

Primary references: the [Fetch standard](https://fetch.spec.whatwg.org/#http-cors-protocol)
defines browser CORS behavior; [Origin documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin)
explains browser-generated headers and missing-Origin cases. Native clients are not
constrained by those browser restrictions. [pip-audit](https://pypi.org/project/pip-audit/)
is used for known-vulnerability checks in a separate ignored tooling environment;
application dependencies are not changed by installing the auditor.

## Reproduced findings and focused changes

Severity is assessed for the existing loopback, trusted single-user deployment, not
for an authenticated internet service. There is no claim of a complete penetration test.

| Finding | Exploitability / severity | Actual before → after evidence | Change |
| --- | --- | --- | --- |
| Non-chat API JSON was unbounded before parsing | Medium availability risk: native local clients, or callers with an allowed Origin, could submit arbitrarily large unknown fields. Field-length checks happen too late. | Both declared-length and chunked collection requests with a 16 KiB unknown field created a row (201); both now return 413 before mutation. Search also returns 413 without calling retrieval. | Generalize the existing chat body limiter to non-upload `/api/` requests; preserve chat error codes and the distinct multipart limit. |
| Default validation errors reflected private input and could fail on invalid Unicode | Low privacy/reliability risk: the response normally goes to its submitting client, not another origin. Reflection is unnecessary and can enter client diagnostics. | A NUL-bearing canary was echoed; a lone surrogate caused an encoding exception instead of a controlled response. Both now return a fixed 422 without the canary. | Reuse structured, static validation errors across library/search/IDs; keep existing chat/conversation-specific messages. No raw Pydantic input/exception context is returned. |
| Storage checks ran only during initialization | Medium, conditional filesystem risk: an actor able to replace staging/trash directories could redirect writes/moves/cleanup. This requires local storage-write authority; an upload filename alone cannot do it. | Runtime junction/symlink substitution allowed staging outside the root, moved a synthetic original outside it, and let cleanup delete an outside sentinel. All three tests failed before and pass after on Windows junctions and Linux symlinks. | Recheck canonical root/staging/trash directories before operations; reject links/junctions and foreign internal paths. Cleanup refuses unsafe paths with a safe diagnostic. |
| Parallel uploads admitted parallel parser subprocesses | Medium local availability risk: timeout/size limits bounded each parser but did not bound concurrent parser count. | A blocked first child allowed a second child to start; now the second validation returns `409 validator_busy` without spawning. Retry succeeds after completion and after a start failure. | One nonblocking validation slot per API process, released in `finally`. Existing processing/indexing/generation gates are unchanged. |
| PDF response setup could leak an already-open handle | Low reliability/availability risk, conditional on an OS/header setup failure; repeated failures can retain handles and interfere with Windows deletion. | Both injected `fstat` and response-construction failures left a retained handle open; both now close it before re-raising. | Guard setup after opening, retaining existing stream/disconnect/cancellation cleanup and deletion transactions. |
| New POSIX storage inherited permissive umask defaults | Medium local confidentiality risk on a multi-account host; Windows ACL behavior is different. | In a controlled Linux container with umask 022, old code created directories/files as 0755/0644; new code creates 0700/0600. Linux regression passes. | Restrict creation modes only. No chmod of existing uploads/directories or Windows ACL modification. |

The initial **ten failing Windows regression cases all pass after the fixes**. The
POSIX before/after harness loads the original storage module from the base commit and
the new module in the same disposable container, isolating umask effects. A malformed
Unicode search request was also tested: it was already rejected before retrieval;
no search/schema or AI behavior change was needed.

Storage pathname checks are detection, not a race-proof filesystem sandbox. A hostile
storage owner can still race an I/O, directly modify files or use the unauthenticated
API. Hard links and malicious parent-directory ownership are not solved by link checks.
If unsafe layout is detected, cleanup deliberately refuses to follow it; operator
attention may be required for leftover owned temporary files. No automatic recovery
or deletion of unknown files was introduced.

## Existing boundaries verified

- Exact approved browser write origins work; untrusted, `null`, malformed and
  lookalike origins return 403 without mutation. Missing Origin and forged approved
  origins remain usable by native clients, demonstrating why these checks are not auth.
- Unapproved Host names, lookalike localhost names and a nonlocal IP Host return 400.
  Real CORS preflight returns 200 for the configured frontend and 400 for an unapproved
  origin; no credentialed/wildcard CORS was enabled. Unsupported PUT returns 405.
- The live Uvicorn parser **accepted duplicate Host fields when the first was allowed**
  (200). It is not claimed to reject all malformed HTTP. Browsers cannot select arbitrary
  Host fields; no proxy/smuggling architecture was introduced. Forwarding this API
  through an untrusted proxy requires a separate threat model.
- Declared and streamed JSON bounds and declared multipart bounds were exercised over
  real loopback HTTP. Existing tests cover oversized files, malformed/repaired/encrypted
  PDFs, excessive pages, unsafe renames, controls, invalid/missing UUIDs and failure cleanup.
  Upload path components (including Windows fake paths) become a display basename;
  internal disk names remain application-owned UUIDs. They are not interpreted as paths.
- A valid synthetic PDF with an appended HTML/script suffix is accepted structurally
  and returned byte-for-byte as `application/pdf`, `nosniff`, no-store, with restrictive
  PDF CSP. This is deliberate: validation is **not** polyglot detection, malware scanning
  or original-file sanitization. Downloading/opening originals in another viewer remains
  a separate untrusted-file boundary. React/PDF.js does not execute the appended HTML.
- Existing tests verify repeated parser/processing/indexing failures, rollback,
  storage permission errors, retained original bytes and retry. Five existing streaming
  completion/error/cancellation cases pass; three real aborted 4 MiB synthetic downloads
  were each followed by 204 deletion with no metadata/file/trash leftovers. No retry was
  needed in these live cycles; this does not guarantee Windows will never lock a file.
- Existing mock and real-PostgreSQL tests exercise hostile source/history text, fixed
  document/collection scope, fabricated citation labels, invalid pages, model/digest
  changes and source availability. Those safeguards and prompts are unchanged. The
  model has no filesystem, SQL or external-network tool authority. Ollama destinations
  come from configuration; HTTP clients ignore environment proxies, have deadlines/
  bounded responses and do not follow redirects. Evidence is serialized as untrusted data.
- Existing frontend escaped-claim/filename/excerpt/search tests pass. A new test verifies
  malicious fallback markup stays inert, is labelled **not an answer**, creates no active
  HTML/link, and opens only the supplied source through an explicit user action.
- Expected database, storage, parser and configuration errors expose safe error classes
  and messages; redaction tests pass. Application logging sites do not log PDF text,
  questions or conversation bodies. Ordinary server access logs may contain request
  paths/IDs; this is not a guarantee that arbitrary third-party/debug logging is private.

Native API/Vite defaults and Compose host-published ports remain loopback-only. The
backend container runs as `ragvault`; PostgreSQL's entrypoint drops to its database user.
Nginx retains its upstream master/worker setup, serves static files and has no uploads/
database credentials mounted. Compose retains the existing PostgreSQL named volume,
backend upload bind mount, private service network and host Ollama connection. Startup
scripts, `.env.example`, model settings and service ownership rules are unchanged. Full
regression tests cover their dependency/port/configuration/reuse/owned-cleanup behavior.

## Actual regression and build results

Commands ran against the final application/test changes. Logs, raw audit outputs,
baselines, synthetic PDFs and harnesses are ignored under `.artifacts/m9-2`.

| Check | Actual result |
| --- | --- |
| Backend `pytest -m "not postgres"` | **419 passed, 1 skipped, 21 deselected**; only POSIX modes skipped on Windows |
| Separate native PostgreSQL/pgvector `RAGVAULT_TEST_POSTGRES=1 pytest -m postgres` | **21 passed**, using disposable schemas, after service recovery |
| Focused security tests, Windows | **27 passed, 1 POSIX skip** |
| Same focused tests in Linux backend image | **28 passed**, including POSIX modes and symlink containment |
| Fresh isolated PostgreSQL image/migration verification | Upgrade from empty DB to **0004_conversations**, `alembic check` clean; **21 integration tests passed** in a disposable tmpfs database |
| Existing database revision/schema consistency | **0004_conversations (head)**; no new upgrade operations detected; no user migration applied |
| Frontend full Vitest suite | **288 passed, 22 files** |
| Ruff lint and formatting | Passed |
| ESLint, Prettier, TypeScript | Passed |
| `pip check`, `npm ls --all` | Passed |
| Frontend production build | Passed, including local PDF.js assets |
| Compose quiet validation / all three image builds | Passed; PostgreSQL major/base digest/runtime configuration retained |
| Backend container smoke | Startup, real database/Ollama health, Host and Origin checks passed; no public-table mutation |
| Frontend container smoke | Root/SPA chat fallback, JS bundle and actual fingerprinted PDF worker passed; worker bytes matched the built file |
| Live synthetic workflow | Upload/original hash/process/index, scoped page-2 retrieval, saved cited answer, duplicate-request replay and follow-up passed |
| Live HTTP probes and download cleanup | Origin/Host/preflight/JSON/multipart/method/validation checks passed as described above; three cancellation/deletion cycles passed |

The initial Docker build could not reach the stopped Desktop engine. Initial 21
PostgreSQL integration cases errored on connection timeouts while the existing container
was stopped; they were **not** counted as passed. Docker Desktop was started normally,
then the existing database container was started with `--no-recreate`. Fresh reruns passed.
No service/volume reset was used. Pytest emits the pre-existing Starlette/httpx deprecation
warning. The extra Linux integration harness also emitted marker-registration warnings
because tests were mounted without the host pytest config; all 21 selected cases ran.

The real model generated **2 accepted claims** for the synthetic garden question:
retrieval/generation/verification/total **125 / 11500 / 31 / 11656 ms**. A follow-up
produced **2 accepted claims**, fixed document scope and four persisted messages:
**2172 / 10532 / 15 / 12719 ms**. These are observations, not quality/performance
guarantees. The existing 4K context budget, greedy evidence selection, conservative
citation acceptance and possible incomplete/irrelevant answers remain unchanged.

## Dependency and container security results

Audits are point-in-time advisory matches, not proof of exploitability or absence of
unknown vulnerabilities. The Python auditor was installed in a separate ignored tooling
venv. Only public package names/versions were supplied. App runtime versions were unchanged.

- `npm audit`: **0 vulnerabilities**, including development dependencies.
- Installed Python environment: initial `pip 25.0.1` produced **12 advisory records
  (6 unique IDs)**; no other installed package had findings. The app venv installer was
  upgraded to **26.2.2**, and `pip-audit` reran with **0 known vulnerabilities**. System
  Python and other environments were not changed. The backend image now explicitly
  installs pip 26.2.2 before installing the app. See the [official pip changelog](https://pip.pypa.io/en/stable/news/).
- The initial 28 October frontend image updated same-release Alpine **curl/libcurl 8.22.0-r0 →
  8.23.0-r0** and **brotli-libs 1.2.0-r1 → 1.2.1-r0**. Scout findings fell from
  **37 to 12**, removing **25 advisory records**. The image was rebuilt and smoke-tested.
- During that initial assessment, a same-release musl patch was attempted without switching repositories or base images.
  The configured Alpine indexes still supplied **1.2.6-r3**, while the advisory requests
  **1.2.6-r6**. It did not change the scanner finding. The vendor-data review on 29 October
  establishes that Alpine already backported the fix in **1.2.6-r3**; see final triage below.
  Ineffective Dockerfile changes were removed;
  the database Dockerfile is unchanged. No patched-musl claim is made. See
  [Alpine's security release announcement](https://www.alpinelinux.org/posts/Alpine-3.21.9-3.22.7-3.23.7-3.24.3-released.html).

| Initial 28 October built image | Scout records by severity | Preliminary context, superseded by final triage below |
| --- | --- | --- |
| Backend | **37**: 7 high, 3 medium, 27 low | Debian OS advisories plus vendored pip BOM packages (setuptools/urllib3/msgpack). These are not installed standalone app dependencies. Installer activity is outside API request handling, but the findings are retained, not suppressed. |
| Frontend | **12**: 1 high, 5 medium, 5 low, 1 unspecified | libxml2 and musl; no critical records. Musl's unspecified scanner severity is not an assessment that it is harmless. |
| PostgreSQL/pgvector | **73**: 4 critical, 31 high, 29 medium, 7 low, 2 unspecified | Primarily Go runtime/modules embedded in the upstream `gosu` helper, plus musl/libxml2. The helper is not a network server, but no blanket false-positive dismissal is made. Existing database container/image was not replaced. |

Remaining image advisories are disclosed; **container scans are not clean**. There was
no libxml2 patch in the configured Alpine package index; musl's vendor backport was
confirmed during final triage. Replacing
the database base/helper, mixing distribution repositories, replacing vendored installer
components or rebuilding system libraries was not attempted. Such changes need controlled
compatibility verification, especially before adopting an image against existing data.
Backend zlib **CVE-2026-85091** remains reported without a fixed trixie package; the
[Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-85091) documents the
affected-range discussion. It was not silently ignored.

Native Python remains **3.12.10**. Package audits do not audit the interpreter/OS or
vendored components comprehensively. [Python 3.12.16](https://www.python.org/downloads/release/python-31216/)
contains later security fixes and is source-only; an operator-managed supported Windows
runtime upgrade is recommended separately. The built backend uses **Python 3.12.16**.
No system interpreter migration, automatic model install or database upgrade was performed.
Dependency ranges/base tags also mean future clean installs can resolve differently;
these results describe the exact locally tested versions/images, not all future builds.

## Privacy, preservation and residual risks

The final audit compares original `.env`/upload hashes, six public-table row digests,
processing/indexing states, PostgreSQL cluster identity/mounts, models and Git refs with
the private pre-change snapshot. Only synthetic QA schemas/files/conversations were
created and removed. The original application data/configuration is not used as a test
fixture. No original document content or screenshot is included in the changes.

Candidate source/documentation and reachable `main` history are scanned for configured
secrets (including encoded forms), token/key patterns, personal Windows paths and private
email addresses. Generated artifacts, uploads, caches, `.env` and tooling environments
are excluded by `.gitignore`. Full raw logs/recovery helpers are not publication assets.
The initial final audit passed **254 candidate files, 16 reachable main commits and 459 history
blobs**, with **no findings**. **163 other tracked backend/frontend files** match their
base Git objects. Original `.env`/upload hashes, all six table digests, cluster identity,
volume mounts and Ollama model names/digests/sizes match the baseline. The owned empty
QA schema is confirmed absent. Git history and user refs are preserved; the initial ten-file
inventory gained the container-constraints file during final triage, and the index is empty. The local venv's
pip installer update is the only persistent tooling-environment change.

Remaining risks: unauthenticated local access; a hostile storage/service owner and I/O
races; unchanged existing permissions/Windows ACLs; native parser code without a full OS
sandbox; untrusted originals opened outside the app; no global disk quota/rate limiter;
multi-process admission limits multiplying by worker count; SQL/filesystem crash recovery
requiring operator reconciliation; advisory findings above; model hallucination/prompt
injection affecting answer quality despite scope/tool/citation restrictions. Safe metadata
and source checks do not independently establish factual truth. Broader network/shared-host
deployment requires authentication and a different architecture. No production-readiness
or complete security certification is claimed. Stage 9.3 was not started.

## Final container triage — 29 October 2026

This section supersedes the preliminary container applicability conclusions above.
All original **43 high/critical image-advisory records** were reviewed: 7 backend,
1 frontend and 35 PostgreSQL. These are records, not 43 independent vulnerabilities:
the msgpack CVE/GHSA are aliases and libxml2 appears in two images. Raw SARIF, exact
binary inspection, vendor records and tool output remain ignored under
`.artifacts/m9-2-triage`. No VEX exclusions, scanner ignores, severity filters, database
resets or production-container replacements were used.

### Actual change and compatibility decision

The frontend runtime changes from `nginx:stable-alpine` to the official
**`nginx:1.30.6-alpine-slim`**, pinned to multi-platform digest
`sha256:dede8895648b461178c3bc604f7eed4423efe5220b2c4d839f5eb3d34ac3f8f7`.
Both inspected images run **Nginx 1.30.6 / Alpine 3.24.3 / musl 1.2.6-r3**. The
application needs static hosting and SPA fallback, not the full image's optional
XSLT/XML modules, curl or Brotli libraries. The slim image omits those unused
dependencies; it does not disable source validation, headers or any application
feature. The previous curl/Brotli upgrade line is unnecessary in this runtime.
Nginx configuration, Node build stage and compiled application are unchanged.
The [official Nginx image documentation](https://github.com/docker-library/docs/blob/master/nginx/README.md)
describes these image variants. Route, real bundle, worker and font byte checks passed.

PostgreSQL remains the existing **17.11 / Alpine 3.24.3**, with the original base
digest and pgvector **0.8.7**. The current official same-version candidate
`postgres:17.11-alpine3.24`, index digest
`sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b`,
was pulled and inspected only in disposable containers. It still supplies **gosu 1.19,
Go 1.24.6, libxml2 2.13.9-r2 and musl 1.2.6-r3**; it does not remediate the findings
under review. Therefore there is no unnecessary database base-digest change. A switch
to Debian, another PostgreSQL major, a locally rebuilt privilege helper or a manually
replaced libxml ABI was rejected as disproportionate to the demonstrated exposure.
Neither the original database container nor its volume was recreated or migrated.

A fresh unconstrained backend build reproduced resolver drift relative to the previous
verified environment: **pydantic-settings 2.16.1 → 2.16.2** and **Starlette 1.9.0 →
1.10.0**. Those unrelated updates were not accepted. The final image restores
**2.16.1 / 1.9.0** and uses `backend/constraints-container.txt` with both pip install
steps to pin the verified Linux runtime closure. The constraints contain no credentials,
do not install native development tools, and do not change `pyproject.toml`, the host
venv or `.env`. Package hashes/build-time isolation dependencies and the Python base
tag are not fully locked; this is runtime version control, not a complete reproducible
build or a guarantee against supply-chain attacks. Future security version changes must
update the constraints intentionally and rerun audits/regressions. The backend was
rebuilt, its installed versions checked against every constraint, and all backend/PG
checks and its scan were rerun against the constrained image.

### Backend and XML findings — every high record

The listed fixed versions are vendor package fixes, **not** a claim that installing a
standalone package overrides pip's private vendored copy. The current pip release
reported by PyPI remains **26.2.2**. In the backend, actual imports show pure-Python
`pip._vendor.msgpack.fallback`, no msgpack native object, no `setuptools` module or
`package_index.py`, and vendored urllib3 **2.7.0**. BOM membership alone is insufficient
to identify the vulnerable implementation.

| Image / advisory | Installed component | Available vendor fix | Applicability and safe remediation |
| --- | --- | --- | --- |
| Backend — [CVE-2026-114613](https://github.com/msgpack/msgpack-python/security/advisories/GHSA-j586-36cw-2gc2) | pip BOM msgpack **1.1.2**, pure Python | msgpack **1.2.3** | Vendor identifies a C-extension map-error leak; that extension is absent, and the API consumes JSON, not MessagePack. Not an application exposure in this image. Retain finding; adopt a future pip vendoring update rather than editing its internal files. |
| Backend — [CVE-2026-57585](https://github.com/msgpack/msgpack-python/security/advisories/GHSA-6v7p-g79w-8964) | Same msgpack **1.1.2** | **1.2.1** | Native Unpacker reuse after an error can cause an out-of-bounds read/crash. Installed pip uses the Python fallback, not the affected native object. No API MessagePack decoder exists. |
| Backend — [GHSA-6v7p-g79w-8964](https://github.com/msgpack/msgpack-python/security/advisories/GHSA-6v7p-g79w-8964) | Same msgpack **1.1.2** | **1.2.1** | Duplicate alias of the preceding CVE, not another independent weakness. Same non-applicable native-code condition. |
| Backend — [CVE-2025-47273](https://github.com/pypa/setuptools/security/advisories/GHSA-5rjg-fvgr-3xxf) | BOM setuptools **70.3.0** provenance; only `pkg_resources` is vendored | setuptools **78.1.1** | Vulnerable `setuptools.package_index.PackageIndex` downloader is absent. No application package download endpoint. Vendor now rates this moderate, while this scanner record is high; retain both facts. Installing unrelated setuptools would not fix a BOM provenance match. |
| Backend — [CVE-2026-97687](https://github.com/urllib3/urllib3/security/advisories/GHSA-8988-9cw3-xx77) | pip-vendored urllib3 **2.7.0** | urllib3 **2.8.0** | HTTPS-proxy/target TLS-context separation failure. RAGVault uses HTTPX, local configured Ollama, `trust_env=False` and no API-controlled proxy. Not reached by app requests. Can matter to installer/build operations using the affected proxy/TLS configuration; retain conditional tooling risk until pip vendors the fix. |
| Backend — [CVE-2026-97689](https://github.com/urllib3/urllib3/security/advisories/GHSA-vxq7-64xx-v4gw) | pip-vendored urllib3 **2.7.0** | urllib3 **2.8.0** | Unbounded chunk-size-line buffering from a malicious HTTP peer. API/Ollama traffic uses HTTPX, not this copy. Installer use against a hostile package index/mirror remains a real conditional build-time DoS risk. Use trusted verified package sources; adopt a patched pip when available or an independently verified offline wheelhouse. No unsafe vendored-code surgery was performed. |
| Backend — [CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091) | Debian zlib **1:1.3.dfsg+really1.3.1-1**; Python runtime confirms **1.3.1** | Upstream fix **df84af25dc1942490e1d1c899a07619152a46148**; Debian sid **1:1.3.dfsg+really1.3.2-4**, no fixed trixie package listed | CNA describes nonblocking `gzprintf`/`gz_vacate` in **1.3.1.2–1.3.2**, whereas Debian still marks 1.3.1 vulnerable and affected-range discussion remains unresolved. No RAGVault gzip-formatted nonblocking writer path was identified. Preserve as unresolved vendor discrepancy/conditional native-library risk, not an adjudicated false positive. Do not install sid libraries into stable. |
| Original frontend — [CVE-2026-86140](https://github.com/GNOME/libxml2/commit/d1686f91dbda141a752200419d35639fd6b38340) | libxml2 **2.13.9-r2** | Upstream **2.15.4**; no fixed package in configured Alpine 3.24 index | `xmlSnprintfElements` stack-buffer overflow during XML validation/error formatting. No active XSLT/XML module in the inspected serving config; an installed dormant dependency was not an established request exploit. Removed the unused dependency by selecting the same-version slim runtime. Final image contains no libxml2 and this record is gone. |
| PostgreSQL — same [CVE-2026-86140](https://github.com/GNOME/libxml2/commit/d1686f91dbda141a752200419d35639fd6b38340) | libxml2 **2.13.9-r2**, linked by PostgreSQL | Upstream **2.15.4**; configured Alpine index remains **2.13.9-r2** | Genuine older linked library, not removable from the existing XML-enabled server. HTTP routes use parameterized SQL and no XML column/parser/expression or arbitrary-SQL API. Not reachable through the current PDF/search/chat inputs. Direct SQL/XML workloads or future extensions require renewed assessment and a vendor-patched compatible base. Do not claim all SQL/XML callers are safe. No runtime library substitution was attempted. |

The [zlib vendor discussion](https://github.com/madler/zlib/issues/1310) contains both
the upstream fix and conflicting affected-range analysis. This assessment does not
override Debian's classification. Likewise, absence of an HTTP entry point into XML
does not fix the underlying database library.

### PostgreSQL's four critical and thirty Go high records

All **34** records below identify Go stdlib **1.24.6** inside **`/usr/local/bin/gosu`
1.19**, not PostgreSQL server code. The actual Linux/amd64 binary is non-setuid 0755;
its entrypoint resolves the local user/groups, drops identity and execs PostgreSQL.
It is not an HTTP/TLS/mail/XML server. The exact binary was copied from the image
without attaching a data volume, its Go build metadata was inspected, and unfiltered
**`govulncheck v1.1.4 -mode=binary -json`** ran in a disposable Go 1.26.10 container.
This is the version pinned in the vendor's own wrapper; its exclusions were **not** used.

Every one of the 34 matching official Go records was present in the tool's database
output. None had a vulnerable-symbol finding. Two have explicitly Windows-only
preconditions; the other affected functions are absent or unused in gosu's source.
The [gosu security policy](https://github.com/tianon/gosu/blob/1.19/SECURITY.md)
explicitly distinguishes compiler-version matches from code gosu actually invokes.
Binary symbol analysis lacks call stacks and has limitations; it is supporting evidence,
not a runtime proof or blanket scanner suppression. See the
[official govulncheck documentation](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck).

The table lists the vendor's fixed Go branches independently. Replacing the host Go
tool or installing an Alpine Go package does **not** change an already embedded binary.
There is no justified requirement to recompile this privilege-switching component
solely to remove unreachable compiler-level matches.

| CVE / official Go advisory | Scanner severity | Affected installed package | Vendor fixed Go version(s) | Required function / current applicability |
| --- | --- | --- | --- | --- |
| [CVE-2025-68121](https://pkg.go.dev/vuln/GO-2026-4337) | critical | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.24.13, 1.25.7, 1.26.0-rc.3 | `crypto/tls`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-39821](https://pkg.go.dev/vuln/GO-2026-5026) | critical | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.13, 1.26.6, 1.27.0-rc.3 | `net/http`, `net/http/internal/http2`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-56857](https://pkg.go.dev/vuln/GO-2026-6604) | critical | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | Windows junction operations; Linux binary, so platform does not apply. |
| [CVE-2026-78663](https://pkg.go.dev/vuln/GO-2026-6612) | critical | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | `net/http`, `net/http/internal/http2`; affected symbols not found in the inspected gosu binary. |
| [CVE-2025-58187](https://pkg.go.dev/vuln/GO-2025-4007) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.24.9, 1.25.3 | `crypto/x509`; affected symbols not found in the inspected gosu binary. |
| [CVE-2025-58188](https://pkg.go.dev/vuln/GO-2025-4013) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.24.8, 1.25.2 | `crypto/x509`; affected symbols not found in the inspected gosu binary. |
| [CVE-2025-61723](https://pkg.go.dev/vuln/GO-2025-4009) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.24.8, 1.25.2 | `encoding/pem`; affected symbols not found in the inspected gosu binary. |
| [CVE-2025-61725](https://pkg.go.dev/vuln/GO-2025-4006) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.24.8, 1.25.2 | `net/mail`; affected symbols not found in the inspected gosu binary. |
| [CVE-2025-61726](https://pkg.go.dev/vuln/GO-2026-4341) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.24.12, 1.25.6 | `net/url`; affected symbols not found in the inspected gosu binary. |
| [CVE-2025-61729](https://pkg.go.dev/vuln/GO-2025-4155) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.24.11, 1.25.5 | `crypto/x509`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-25679](https://pkg.go.dev/vuln/GO-2026-4601) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.8, 1.26.1 | `net/url`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-32280](https://pkg.go.dev/vuln/GO-2026-4947) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.9, 1.26.2 | `crypto/x509`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-32281](https://pkg.go.dev/vuln/GO-2026-4946) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.9, 1.26.2 | `crypto/x509`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-32283](https://pkg.go.dev/vuln/GO-2026-4870) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.9, 1.26.2 | `crypto/tls`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-33811](https://pkg.go.dev/vuln/GO-2026-4981) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.10, 1.26.3 | `net`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-33814](https://pkg.go.dev/vuln/GO-2026-4918) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.10, 1.26.3 | `net/http`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-33818](https://pkg.go.dev/vuln/GO-2026-5972) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.13, 1.26.6, 1.27.0-rc.3 | `encoding/asn1`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-39820](https://pkg.go.dev/vuln/GO-2026-4986) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.10, 1.26.3 | `net/mail`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-39822](https://pkg.go.dev/vuln/GO-2026-4970) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.12, 1.26.5, 1.27.0-rc.2 | `os.Root` operations; gosu uses no confined-root filesystem API. |
| [CVE-2026-39836](https://pkg.go.dev/vuln/GO-2026-4971) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.10, 1.26.3 | Windows NUL-port handling; Linux binary, so platform does not apply. |
| [CVE-2026-42499](https://pkg.go.dev/vuln/GO-2026-4977) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.10, 1.26.3 | `net/mail`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-42504](https://pkg.go.dev/vuln/GO-2026-5038) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.11, 1.26.4 | `mime`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-56853](https://pkg.go.dev/vuln/GO-2026-6089) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.13, 1.26.6, 1.27.0-rc.3 | `net/http`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-56859](https://pkg.go.dev/vuln/GO-2026-6088) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.13, 1.26.6, 1.27.0-rc.3 | `encoding/xml`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-56862](https://pkg.go.dev/vuln/GO-2026-6090) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.25.13, 1.26.6, 1.27.0-rc.3 | `crypto/tls`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-56866](https://pkg.go.dev/vuln/GO-2026-6605) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | `net/http`, `net/http/httputil`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-78659](https://pkg.go.dev/vuln/GO-2026-6603) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | `net/http`, `net/http/internal/http2`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-78660](https://pkg.go.dev/vuln/GO-2026-6610) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | `net/http`, `net/http/internal/http2`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-78667](https://pkg.go.dev/vuln/GO-2026-6609) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | `net/http`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-78669](https://pkg.go.dev/vuln/GO-2026-6611) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | `net/http`, `net/http/internal/http2`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-94439](https://pkg.go.dev/vuln/GO-2026-6613) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | `net/http`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-94440](https://pkg.go.dev/vuln/GO-2026-6608) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | `mime/multipart`, `net/textproto`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-97031](https://pkg.go.dev/vuln/GO-2026-6607) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | `crypto/tls`; affected symbols not found in the inspected gosu binary. |
| [CVE-2026-97032](https://pkg.go.dev/vuln/GO-2026-6617) | high | Go stdlib **1.24.6**, in PostgreSQL `gosu 1.19` | 1.26.9, 1.27.2 | `net/http`, `net/http/internal/http2`; affected symbols not found in the inspected gosu binary. |

The tool did separately find three symbol-level traces for **one medium advisory**,
[GO-2026-6686](https://pkg.go.dev/vuln/GO-2026-6686), affecting
`github.com/moby/sys/user 0.1.0` (`GetExecUser`, `ParseGroupFilter`, `GetExecUserPath`).
These are present in the real helper, unlike the high/critical matches. Exploitation
requires supplying hostile local passwd/group database contents; PDFs and app API
requests cannot write those root-owned files. The
[gosu 1.20 vendor release](https://github.com/tianon/gosu/releases/tag/1.20) fixes this
with **moby/sys/user 0.4.1**, while deliberately retaining **Go 1.24.6**. The currently
available same-version PostgreSQL candidate still uses 1.19. Recommended maintenance:
adopt and test the official same-major/base-family image once it includes 1.20, or
separately review a vendor-signature-verified helper update. It is not an urgent local
HTTP attack path, and no unauthenticated internet binary was spliced into the database
image during this stage. New symbol findings were not hidden to obtain a clean result.

### Musl discrepancy and final scan counts

The remaining frontend record is **CVE-2026-107891**, for musl **1.2.6-r3**, classified
unspecified by Scout with a suggested fix **1.2.6-r6**. The authoritative
[Alpine 3.24 security database](https://secdb.alpinelinux.org/v3.24/main.json) explicitly
lists **1.2.6-r3** as the fixed/backported version for this CVE; this is the version
actually installed. The earlier report's implication that a missing r6 patch left musl
unfixed was incorrect. This is a vendor-backport/version-matching discrepancy, not a
reason to mix Alpine releases. The raw record remains visible; it was not ignored.

| Final image | Before this triage | After triage | High / critical after |
| --- | --- | --- | --- |
| Backend | 37 | **37** | **7 high, 0 critical**; applicability above |
| Frontend | 12 | **1** | **0 high, 0 critical**; vendor-fixed musl record retained |
| PostgreSQL/pgvector | 73 | **73** | **31 high, 4 critical**; 34 Go records lack affected symbols, one linked XML-library high has no current API path |

No confirmed exploitable critical/high path was found in the current local-first HTTP
application. This is narrower than declaring every component fixed. Remaining actionable
maintenance consists of vendor library/installer updates and review if SQL/XML workloads,
untrusted package sources, proxy configurations or deployment boundaries change.
The urllib3 installer DoS/proxy conditions are genuine conditional tooling risks; the
zlib classification remains unresolved. Lack of authentication and trusted-host/storage
assumptions remain independent architectural risks. Do not treat this triage as approval
for shared-host or public deployment.

### Fresh checks, failures and preservation

Windows Application Control blocked the local SQLAlchemy optional native extension
before native backend tests could run. The policy and venv were not changed or bypassed.
Backend regressions, formatting and schema checks were instead executed in Linux
containers against the same application source. The first two container harness runs
passed 416 tests and failed four preflight mock cases because the installed image lacks
the repository-layout migration directory. Its actual development-preflight root was
confirmed, the migrations were mounted read-only at the expected location, and all four
targeted cases then passed. This was a harness layout correction, not an application fix;
the final complete run is recorded below. Earlier failures are not presented as passes.

All three images rebuilt. The frontend passed root/Documents/Search/Chat SPA routes,
real JS bundle, fingerprinted PDF worker and local font byte checks, plus Nginx config
validation. Backend startup, real PostgreSQL/Ollama health, Host and Origin smoke checks
passed. A separate empty tmpfs PostgreSQL container passed fresh migrations through
`0004_conversations`, schema checking and **21 PostgreSQL/pgvector tests**; only that owned
container was removed. The existing database's revision/schema checks passed without
applying migrations. **288 frontend tests** and ESLint/Prettier/TypeScript/build/dependency
checks passed. Ruff lint/format and `pip check` passed in Linux. Fresh npm and installed
backend-image Python dependency audits both report **zero known vulnerabilities**;
this does not contradict the separately retained vendored-component/OS Scout records.

The final full Linux backend run passed **420 tests, 21 PostgreSQL cases deselected,
no skips**, including the POSIX security case. Separate PostgreSQL
integration passed **21 tests**. All frontend checks passed with
**288 tests / 22 files**. Python/Node audits were rerun successfully; all three unfiltered
Scout scans completed. Both backend suites and the backend audit were repeated after
restoring and constraining the runtime versions; all 34 constraints match the installed
image with no unexpected packages. Backend application code, migrations and the database
Dockerfile are unchanged by container triage.
The Windows native suite is **unavailable in this triage**, not reported as rerun/passed.
Existing deprecation and isolated-harness marker warnings are retained in ignored logs.

The original six-table/cluster/config/upload snapshot matched before triage, using
read-only queries through the existing PostgreSQL container to avoid the blocked Windows
extension. Final preservation/privacy checks compare both that fresh snapshot and the
initial Stage 9.2 state. No original PDF, conversation or index state is used as a fixture.
This triage changes the already pending frontend/backend Dockerfiles, adds container
runtime constraints, and updates this report. Application source is unchanged by triage;
the complete Stage 9.2 inventory below now contains eleven files.
At triage completion, Git history, index, `.env`, models and original volumes were
preserved, and no commit or push had been performed. The subsequent authorization
permits publication of Stage 9.2 only; Stage 9.3 remains outside scope.

Final triage privacy/preservation audit: **255 candidate files, 16 reachable main
commits, 459 history blobs, zero findings**. **163 other tracked backend/frontend files**
still match their base objects. All original `.env`/upload hashes, six table digests,
cluster identity, volume mounts and model digests match both preservation baselines.
At that pre-publication checkpoint, no owned QA schema remained and all **11** intended
files were unstaged on base `a231671112966926e98faaec366376b46d5bd1cc`.

## Final publication review — 29 October 2026

The user approved the eleven-file commit and a normal `main`-only push. Each file was
reviewed against the reproduced failures, recorded before/after tests, existing
functionality and disclosure requirements. No application correction was needed.
Only this report was updated for the publication review. Root `.env`, native dependency
environment, PostgreSQL container/major/base digest and migrations are unchanged.

Fresh checks for this publication, with detailed logs under ignored
`.artifacts/m9-2-publication`:

| Check | Fresh publication result |
| --- | --- |
| Full available backend suite, Linux constrained image | **420 passed**, 21 separate PostgreSQL cases deselected; no skips, including POSIX permission/security tests |
| Separate PostgreSQL/pgvector integration | **21 passed** in an owned empty tmpfs database |
| Frontend Vitest | **288 passed**, 22 test files |
| Ruff lint/format, ESLint, Prettier, TypeScript | Passed; 77 Python files formatted |
| Dependency consistency and installed-package audits | `pip check`, `npm ls`, Python audit and npm audit passed; package audits report zero known vulnerabilities |
| Frontend production build and Compose quiet validation | Passed |
| Backend/frontend/PostgreSQL Docker builds | All three passed; no original container recreation |
| Empty-database migrations / existing-schema checks | Fresh migration to **0004_conversations** and clean schema check passed in tmpfs; existing database revision/schema verified without applying migrations |
| Runtime constraints | All **34** installed versions matched; no unexpected runtime packages |
| Slim Nginx smoke | Dashboard/root, Documents, Search and Chat routes, real JS bundle, exact worker/font bytes, configuration validation and absence of libxml2 passed |
| Backend container smoke | Startup, real PostgreSQL/Ollama health, Host and Origin checks passed with temporary storage |
| Unfiltered container scans | Backend **37**, frontend **1**, PostgreSQL **73**; unresolved records retained |

Windows-native import probing again returned **ImportError / Application Control
blocked** for the optional SQLAlchemy extension. This is recorded as unavailable native
verification; Windows policy was not changed and the native suite is not claimed passed.
The Linux full suite is the executed backend result above. Existing deprecation and
isolated-integration marker warnings remain diagnostic output, not hidden failures.

A separate real HTTP API on loopback port 8002 used an owned tmpfs PostgreSQL database,
temporary upload directory and the configured host Ollama models. Its disposable
three-page garden PDF passed upload, original-byte comparison, processing, indexing,
page-2 retrieval with exact document/collection filters and original-source navigation.
A saved answer passed source checks with **2 accepted claims**; a follow-up passed with
**3 accepted claims**, retained document scope and four stored messages. Duplicate
request replay returned the same assistant message. Retrieval/generation/verification/
total timings were **145.52 / 7946.70 / 11.01 / 8104.04 ms** for the first answer and
**87.93 / 1901.63 / 7.09 / 1997.06 ms** for the follow-up. These synthetic observations
are not a factual-accuracy or latency guarantee.

Origin denial, declared/chunked JSON limits and validation redaction also passed over
HTTP. Three 4 MiB synthetic downloads were aborted after their first KiB, then deleted
with **204** responses; each safe repeat returned **404**, with no remaining metadata,
file or trash entry. The six owned database tables were verified empty after fixture
cleanup. Only the verified publication-owned containers and isolated network were
removed; no original volume was attached to the synthetic workflow.

The rebuilt database image's `gosu` SHA-256 matched the exact binary analyzed in the
triage. All **34** high/critical Go advisories remain present in recorded tool evidence,
none has a vulnerable-symbol finding, and medium **GO-2026-6686** remains disclosed.
The security assessment preserves binary-analysis limitations and does not equate
scanner severity with demonstrated exploitability. Final scan severities remain
**7 high / 0 critical** in backend, **0 high / 0 critical** in frontend and **31 high /
4 critical** in PostgreSQL. XML, zlib, vendored urllib3 and the musl backport discrepancy
retain the applicability/remediation explanations above. No suppression was added.

Pre-publication Git checks confirmed `main` and `origin/main` at the same base, no staged
files, and the approved GitHub noreply identity. A non-interactive main-only push dry run
succeeded. Privacy scans and original-data preservation snapshots are repeated before
staging and after publication. Original file hashes, six public-table digests, cluster
identity/mounts and model digests remain the preservation criteria. Staged blobs must
match the reviewed working files and exact inventory. GitHub Actions for the new commit
is checked **after** the push; local success is not used to claim a remote CI result.
The exact published SHA, Actions URL/results and final Git status accompany publication.

## Complete changed-file inventory (11 files)

- `README.md` — current stage, input/error contract, local security controls and caveats.
- `backend/Dockerfile` — explicit patched pip installer and verified runtime constraints.
- `backend/constraints-container.txt` — exact Linux runtime versions, preventing reproduced build drift.
- `backend/app/api/library.py` — close PDF source if response setup fails.
- `backend/app/core/chat_limit.py` — reuse the existing body limiter across non-upload APIs.
- `backend/app/main.py` — register the generalized limiter and safe validation responses.
- `backend/app/services/storage.py` — runtime path checks, parser admission, new POSIX modes.
- `backend/tests/test_security.py` — 28 focused security regression/boundary cases.
- `frontend/Dockerfile` — pinned same-version slim Nginx runtime without unused XML/XSLT dependencies.
- `frontend/src/features/chat/ClaimAnswer.test.tsx` — inert, explicitly labelled fallback evidence.
- `docs/verification-milestone-9-2.md` — this assessment and actual verification results.

No migration, schema, RAG algorithm, prompt, model, frontend design, startup script,
Compose configuration or existing-data change is included. Approved publication is
limited to these eleven files on `main`; tags, backup/recovery refs and other branches
are excluded. The project remains local-first and single-user, with the documented
security and AI limitations; public source hosting does not authorize public deployment.
