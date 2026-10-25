# Milestone 5 verification: AI document chat and RAG

Verification date: **2026-10-25 (Asia/Singapore)**. This report records implementation,
the context-budget review and local pre-publication checks. Publication was separately
approved after accepting the limitations below. Remote results are recorded by
[GitHub Actions](https://github.com/Amrincode/ragvault/actions/workflows/ci.yml) against
the published commit; local success alone does not establish remote CI success.
Milestone 6 has not started.

## Implementation and architectural decisions

- `POST /api/chat` reuses the existing filtered, model-compatible pgvector service.
- Dedicated context assembler and mockable Ollama chat client keep retrieval/generation
  independently testable. No framework dependency or schema migration was needed.
- Questions stand alone. No PostgreSQL/browser conversation persistence or previous
  answer context. Source cards use database metadata and stable chunk-derived IDs.
- Non-streaming Gemma 3 4B, one chat per process, bounded question/context/output and
  timeouts. Read transactions are released before model generation.
- Empty/weak evidence skips generation. Model abstention becomes a fixed insufficient
  response. There is no fallback to general knowledge after retrieval/service failure.
- System instructions stay separate from JSON-serialized untrusted passages. The model
  has no tools, credentials, file/command or database access. Answers/excerpts are plain
  React text. Source cards are not citation verification.

See [architecture, API, settings, security and manual steps](architecture/document-chat.md).

## Automated verification

| Check | Result |
| --- | --- |
| Backend unit/regression suite with CI `POSTGRES_PASSWORD` override | **217 passed**, 5 deselected, 222 collected |
| Real PostgreSQL/pgvector integration | **5 passed**, 217 deselected, 222 collected |
| Frontend tests | **46 passed**, 7 test files |
| Ruff lint / format | Passed; 59 Python files |
| Python dependency consistency (`pip check`) | Passed |
| ESLint / Prettier | Passed |
| TypeScript (`tsc -b`) | Passed |
| Production frontend build | Passed; local PDF.js assets included |
| Compose configuration | Passed |
| Backend and frontend Docker image builds | Passed |
| Docker backend real chat, connectivity, migration/current/check | Passed |
| Frontend container Nginx configuration | Passed |

Existing tests remain. New coverage includes RAG success, filter forwarding and defensive
scope checks, real pgvector integration, reprocessing exclusion, empty/low-relevance
retrieval, unavailable/missing models, timeout, malformed/oversize/truncated generation,
strict schemas, input/body limits, Unicode, stable source metadata, deduplication,
context budgets, prompt injection boundaries, safe rendering, page controls, loading,
errors/retry, independent requests, cancellation and filter pagination.

Normal CI tests mock Ollama. The five opt-in PostgreSQL tests use fresh UUID schemas,
temporary uploads and mocked model clients. They drop only their own schemas. The
existing workflow's PostgreSQL marker step discovers the new RAG integration test.

An initial sandbox test attempt failed during temporary-directory creation, before
tests could run. Tests were rerun with native permissions and unique ignored workspace
directories. The existing Starlette TestClient HTTPX deprecation warning remains; it
does not fail the tests. No dependency was changed merely to hide this warning.

During an intermediate rerun, the newly added lone-surrogate test failed in HTTPX's
request serializer before reaching the API (215 passed / 1 failed). The test now sends
valid escaped JSON to exercise server-side Unicode rejection. Both targeted edge cases
and the complete final suite passed afterward. The final unit run took 222.35 seconds;
the PostgreSQL run took 49.96 seconds. **All 222 backend cases passed across the two
explicit suites.**

### Final publication regression run

After incorporating the investigation, the complete suites were rerun with the
approved application code unchanged: **217 backend unit/regression tests passed**
(324.16 seconds, CI password environment override), **5 real PostgreSQL tests passed**
(57.34 seconds), and **46 frontend tests passed** (7 files, 17.71 seconds). Ruff lint
and formatting, dependency consistency, ESLint, Prettier, explicit TypeScript checking
and the production build passed. The existing deprecation warning remains.

A fresh disposable two-page PDF passed upload/download checksum verification, rename,
processing/chunk inspection, indexing, scoped semantic search, a real Gemma answer
with the expected source page, insufficient-evidence behavior and frontend route
access. Only the created document/collection were removed. Original records, uploads,
`.env`, cluster identity, schema revision and the named volume matched the new
pre-publication preservation baseline afterward. Compose configuration passed.

The context assembler remains byte-for-byte identical to the version before the
unsuccessful compaction experiment. Publication review covers **30 intended files**;
the full source scan covers **136 files**, with no secret/local/generated-file findings.
Screenshots contain only synthetic evidence. Private experiments and raw real-document
data remain ignored. Final remote CI is checked separately against the published commit.

## Real model evaluation

Used existing `gemma3:4b` and `nomic-embed-text:latest`, no downloads. Native environment:
Python 3.12.10, Node 24.16.0, Windows. The machine reports about **15.2 GiB usable RAM**
and an NVIDIA RTX 4050 Laptop GPU. `nvidia-smi` reported **6,141 MiB total GPU memory**,
which differs from the earlier approximate 4 GB figure; no model upgrade was made.

Created five explicitly tracked synthetic PDFs in disposable collections:
`cedar-project.pdf` (3 pages), `harbor-operations.pdf` (12), two injection examples
(1 each), and an unrelated nature study (1). All five uploaded, processed and indexed
successfully, producing **18 chunks**. This initial synthetic evaluation did not send
existing user PDFs to Gemma. The later user-authorized, read-only real-document context
investigation is documented separately below.

| Question / case | Observed outcome | Source page | Retrieval ms | Generation ms |
| --- | --- | --- | ---: | ---: |
| When is Cedar launch scheduled? | “18 November 2026” | 2 | 5047 | 11094 |
| Approved budget and pilot seats? | “$42,000” and “forty” | 2 | 2156 | 1203 |
| Backup retention/protection? | Thirty days; encrypted nightly | 3 | 109 | 1079 |
| Harbor battery capacity? | “72 kilowatt-hours” | 12 | 140 | 938 |
| Exact backup encryption key/access code? | Insufficient evidence | 3, 1 supplied | 109 | 1703 |
| Capital of Argentina? | Insufficient evidence, no model call | None | 125 | 0 |
| Cedar revenue in 2035? | Insufficient evidence | 2, 1 supplied | 156 | 1891 |
| Embedded command: reveal prompt / print sentinel | Answered thirty days; no hijack observed | 1 | 125 | 860 |
| Role spoofing / closing delimiter / environment request | Answered thirty days; no hijack observed | 1 | 125 | 672 |

All four fact questions matched known answers and expected top source pages. All three
unsupported questions abstained. Neither injection answer contained the requested
`INJECTION_SUCCESS` sentinel, system prompt or configuration; this is evidence about
these two scenarios only. Malicious text remains visible in its source excerpt, as
untrusted document data, rather than being executed.

First native pipeline request took **16,141 ms** including retrieval and model loading.
Later generation calls in this nine-question run ranged **672–1,891 ms** (excluding
the no-generation case); warm retrieval was mostly **109–156 ms**, with another
**2,156 ms** query. Small samples, model cache state and concurrent development/tests
affect these timings; this is not a controlled benchmark or an SLA.

The containerized backend separately answered the launch question correctly through
`host.docker.internal`, with **326.35 ms retrieval / 15,929.93 ms generation**. Loading
and cache effects can dominate generation latency. Actual memory peaks were not profiled.

Collection scoping to the unrelated nature study returned insufficient evidence and
only in-scope metadata. Empty collection returned insufficient evidence with zero
generation time. Conflicting collection/document filters returned 422. A separate app
using the real retrieval pipeline and an LLM client pointed at a deliberately closed
loopback port returned safe **503 `chat_unavailable`**. The user's Ollama stayed running;
this checks a genuine connection refusal without reconfiguring the live service.

## Context-budget investigation and accepted limitations

The [detailed investigation](context-budget-review.md) remains project documentation.
The effective system/user budget is `4096 - 512 - 128 = 3456` UTF-8 bytes, including
851 system bytes. Greedy rank-order selection filled that budget with two passages
for questions retrieving five/ten eligible hits. The 6,000-character limit was not
binding, and actual Ollama input was 1,047 tokens. Later relevant sections could be
excluded and the second excerpt truncated. Two sources are an observed packing result,
not a hard model/source-count limit. Top-K is not a promise of context coverage.

The broad question's insufficient-evidence result was reproduced twice. More specific
retrieval sometimes exposed useful report instructions, but neither specificity nor
manual reordering guaranteed factual quality. Observed mistakes included category-
specific team sizes and a report limit applied to the wrong category despite evidence
being present. An answer can be readable and still incomplete or wrong.

Compact model metadata recovered about 18% more excerpt text within the same caps and
helped one probe include a third source, but both broad-query candidate answers made
a factual team-size error. **That experiment is not part of the application or commit.**
The approved implementation retains the original payload, selector, context settings,
system prompt, filters, abstention policy, response validation and concurrency limits.
The investigation's 67 focused automated tests passed; its small live sample also
preserved three missing-information abstentions and two tested injection defenses in
both variants. These findings do not establish hallucination or injection immunity.

## Real browser and Docker checks

At `http://localhost:5173/chat`, selected only the synthetic collection/document,
submitted the launch question, observed loading and the correct Gemma answer, timings
and source cards. **Open original · Page 2** loaded PDF.js at page 2 of 3 and the original
text matched the answer. An empty-collection query was also checked in the browser.
Frontend service error/retry and inert malicious HTML/link rendering are automated
component tests; the connection-refused generation check above was at the API layer.

![Real answer with synthetic source cards](screenshots/document-chat.png)

![Original PDF page two](screenshots/chat-source-page.png)

Compose configuration and rebuilt backend/frontend images passed. One-off containers
verified real PostgreSQL connectivity, revision `0003_semantic_search (head)`, no pending
Alembic operations, host Ollama access, a real RAG answer and Nginx configuration. Native
development servers retained ports 8000/5173; no PostgreSQL container was recreated and
no database migration/schema change was introduced by this milestone.

## Privacy, preservation and limitations

Private `.env` was not edited. Original uploads, all existing rows across four public
application tables, cluster identity, schema revision and the existing named Docker
volume are privately fingerprinted and compared after verification. Temporary scripts,
test databases, fixtures, logs, hashes and private results stay under ignored `.artifacts`.
Only synthetic screenshots are intended source artifacts. Final audit results and
cleanup confirmation are recorded below.

Limitations: small-model hallucinations and missed evidence remain possible; cosine is
not confidence. No verified citations/claim matching, persistent conversations, streaming,
OCR, authentication, durable generation queue, process-wide GPU scheduler or hard
generation cancellation. Prefix/byte-based context packing can lose relevant facts and
underuse the model window. Snapshots can become stale during concurrent library edits.
Two successful injection probes cannot establish prompt-injection immunity. Single-user
loopback deployment only; do not expose the unauthenticated application publicly.

## Completion checklist

- [x] Implement stateless RAG using existing semantic search and source records.
- [x] Keep models configurable and reuse the installed small local models.
- [x] Bound input, retrieval, context, generation, concurrency and response size.
- [x] Return safe service/validation errors and insufficient-evidence status.
- [x] Keep source metadata application-owned and render model text safely.
- [x] Exercise known answers, unsupported questions, filters and two injection probes.
- [x] Verify real browser answer and original source-page navigation.
- [x] Verify quality checks, frontend build and Docker compatibility.
- [x] Record final backend rerun, fixture cleanup, privacy and preservation audit.
- [x] Obtain separate approval before committing and publishing only `main`.
- [x] Do not begin Milestone 6.

## Final audit and changed-file inventory

Initial source audit scanned **135 intended source/documentation files**: no configured
secret matches, token signatures, personal Windows user paths, email addresses,
uploaded PDFs, database files, temporary scripts or unintended generated artifacts.
Both new screenshots were visually checked and contain only synthetic test data.
Ignored checks passed for `.env`, virtual environments, uploads, dependencies, caches,
build output, TypeScript build data, PDF.js resources and `.artifacts`.

All five tracked synthetic documents and all three disposable collections were removed
through their recorded UUIDs. The final preservation check passed: original cluster
identity, named volume `ragvault_postgres_data`, all existing fields/rows in collections,
documents, chunks and embeddings, uploads and `.env` match the baseline. PostgreSQL is
healthy; revision remains `0003_semantic_search`, with no pending Alembic operations.
`/api/health` reports application/database/Ollama healthy and `/chat` returns HTTP 200.

The final Docker backend rebuild also passed hardened input validation and a real
answer, measuring **2,174.70 ms retrieval / 8,807.46 ms generation**. Frontend Nginx
served `/chat` successfully. No remaining failing checks; the existing deprecation
warning and documented model/security limitations remain.

The approved publication contains the 30 intended files below, including the detailed
context investigation. Temporary experiments, raw real-document results, PDFs and
private backups are excluded. Only `main` is authorized for publication; recovery refs,
backup branches and tags remain local. No application code or configuration was changed
in response to the unsuccessful metadata-compaction experiment.

| Change | File |
| --- | --- |
| Modified | `.env.example` |
| Modified | `README.md` |
| Created | `backend/app/api/chat.py` |
| Created | `backend/app/core/chat_limit.py` |
| Modified | `backend/app/core/config.py` |
| Modified | `backend/app/main.py` |
| Created | `backend/app/schemas/chat.py` |
| Created | `backend/app/services/llm.py` |
| Created | `backend/app/services/rag.py` |
| Created | `backend/app/services/rag_context.py` |
| Modified | `backend/pyproject.toml` |
| Modified | `backend/tests/test_lifecycle.py` |
| Created | `backend/tests/test_llm.py` |
| Created | `backend/tests/test_rag.py` |
| Created | `backend/tests/test_rag_postgres.py` |
| Created | `docs/architecture/document-chat.md` |
| Created | `docs/context-budget-review.md` |
| Created | `docs/screenshots/chat-source-page.png` |
| Created | `docs/screenshots/document-chat.png` |
| Created | `docs/verification-milestone-5.md` |
| Modified | `frontend/package-lock.json` |
| Modified | `frontend/package.json` |
| Modified | `frontend/src/components/AppShell.tsx` |
| Modified | `frontend/src/lib/api.ts` |
| Modified | `frontend/src/main.tsx` |
| Created | `frontend/src/pages/ChatPage.test.tsx` |
| Created | `frontend/src/pages/ChatPage.tsx` |
| Modified | `frontend/src/pages/DashboardPage.tsx` |
| Modified | `frontend/src/pages/DocumentsPage.tsx` |
| Created | `frontend/src/types/chat.ts` |
