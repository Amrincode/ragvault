# Milestone 7 verification — persistent conversations and follow-ups

Verified locally on 25 October 2026 against the published Milestone 6 baseline
`b56d818320714080978cf0b383c1466838b0345e`. That initial checkpoint made no commit or push.
Publication was separately approved on 26 October 2026. Milestone 8 has not started.
See [conversation architecture](architecture/conversations.md) for schema, endpoints,
transactions, history bounds, source availability and security assumptions.

Subsequent chat UX and GIQ reliability work is documented in the
[Milestone 7 stabilization report](milestone-7-stabilization.md), verified on
25–26 October 2026. Current totals are **314 backend**, **21 PostgreSQL integration**
and **78 frontend** tests passed. Measurements below describe the initial implementation;
the stabilization report records the retained improvements and remaining direct page-limit failure.

## Publication verification — 26 October 2026

The full change set was reviewed again, including the additive migration, immutable
scope and deletion behavior, durable pending/failed/completed turns, idempotent recovery,
bounded user-only topic history, source snapshots/fallbacks, scrolling, keyboard handling
and preserved stateless mode. No application functionality was changed during publication.
The remaining accuracy limitations in the stabilization report are retained, including
incomplete answers, imperfect subset selection and the direct advanced page-limit failure.

Checks rerun before committing:

| Check | Actual result |
| --- | --- |
| Complete regular backend suite | 314 passed; 21 PostgreSQL tests deselected |
| Complete PostgreSQL/pgvector suite | 21 passed; 314 regular tests deselected |
| Complete frontend suite | 78 passed in 9 files |
| Ruff lint / formatting | Passed; 72 Python files already formatted |
| Python dependency compatibility | `pip check`: no broken requirements |
| ESLint / Prettier / TypeScript | Passed |
| Production frontend build | Passed |
| npm audit, including development dependencies | 0 known vulnerabilities |
| Compose validation / all three Docker builds | Passed |
| Retained database revision / metadata | `0004_conversations (head)`; no new upgrade operations |
| Isolated real migration upgrades | Base through 0003 and 0004 passed; 0003 sentinel preserved; zero metadata differences |
| Retained PostgreSQL container / volume | Healthy; original named volume retained |

The extra migration harness initially stalled, then needed its version-table reflection
configuration corrected and its console output made compatible with Windows. Its final
run executed the real migration upgrade functions in a disposable schema and passed.
All recorded task-owned migration schemas were removed. No retained migration downgrade
or upgrade was needed. CI runs the standard Alembic CLI upgrade on a fresh PostgreSQL service.

The existing Starlette/httpx test-client deprecation warning remains. The npm audit is
not a Python vulnerability audit; Python dependency compatibility was checked separately.
The prior real-browser and real-Ollama accuracy investigations were not repeated as
part of publication; their exact observations remain in the stabilization report.

Publication uses only the reviewed `main` commit and an explicit fast-forward push to
`origin/main`, with tag following disabled. Recovery refs, other branches and tags stay
local. The final staged blobs and reachable main history are audited for configured-secret
matches, token/key patterns, private email addresses, personal Windows paths and generated
files. The single new screenshot contains only the earlier disposable synthetic workflow;
raw investigation scripts, traces, uploads and local settings are excluded.

Preservation hashes cover all six existing tables, `.env`, uploaded files, PostgreSQL
cluster identity and volume mounts. Unrelated Git refs are compared against their baseline.
GitHub Actions results are checked after the push and reported with its exact commit/run;
see [published workflow runs](https://github.com/Amrincode/ragvault/actions/workflows/ci.yml).

## Implementation and architectural decisions

- Additive `0004_conversations` migration creates conversations and messages. Positions
  and unique request/role constraints establish durable ordering and duplicate protection.
- Immutable scope UUID snapshots survive nullable library FKs. A deleted original target
  blocks new questions instead of broadening retrieval. Conversation deletion removes
  messages and preserves PDFs; document deletion retains historical discussion text.
- Persist a user/pending-assistant pair before retrieval. Conditional database leases
  prevent simultaneous turns; final save is atomic. Failed generations remain failed,
  final-commit failures leave recoverable pending rows, and expired leases recover lazily.
- Reuse the same RAG engine and source validator. Follow-ups expand retrieval with at
  most four completed prior user questions / 600 total characters. Assistant content is
  never sent back as facts. Topic hints stay separate from fresh PDF evidence and count
  inside the existing byte/context budget.
- Store only accepted answer/citation snapshots and summary metadata, excluding rejected
  model diagnostics and unused retrieval passages. Validate saved snapshots on reads;
  distinguish available, stale, unavailable and invalid citations without replacements.
- Extend the existing interface with saved discussions, pagination, scoped history,
  retries, rename/delete confirmation and historical-source notices. Preserve the original
  tested stateless screen at `/chat?mode=single` and the original `/api/chat` endpoint.

## Automated checks actually run

| Check | Result |
| --- | --- |
| Full regular backend suite | **292 passed**, 20 PostgreSQL cases deselected; final run 230.49 s |
| Full PostgreSQL/pgvector suite | **20 passed**, 292 regular cases deselected; 178.10 s |
| Combined backend cases | **312 passed** across the two full suites |
| Full frontend suite | **71 passed** across 9 files; final run 13.40 s |
| Ruff lint / formatting | Passed; 71 Python files formatted |
| Python dependency consistency | `pip check`: no broken requirements |
| Frontend dependency consistency | `npm ls --depth=0` passed; no dependency changes |
| ESLint / Prettier / TypeScript | Passed |
| Frontend production build | Passed, including original PDF.js assets |
| Alembic upgrade/current/check | Applied additive migration; `0004_conversations (head)`; no new upgrade operations |
| Compose validation / Docker builds | Passed for PostgreSQL, backend and frontend; backend rebuilt after final alias validation |
| Built backend smoke | Database/Ollama health, saved messages, historical citations and container Alembic checks passed |
| Built frontend smoke | Nginx served `/chat` HTTP 200 |
| Original-data preservation | All four original public-table snapshots, uploaded bytes, `.env`, cluster and volume unchanged |
| Privacy / generated-file audit | 166 candidate files reviewed; no configured-secret, token/key, personal-path/email or unintended-artifact findings |

The regular backend suite inherited `POSTGRES_PASSWORD=ci-only-password` in its test
process, preserving the configuration-precedence regression. Standard model calls were
mocked. PostgreSQL cases use isolated schemas and disposable PDFs rather than modifying
the user's library. All earlier tests remain; the earlier chat-page test harness simply
selects the retained stateless URL mode. One existing Starlette/httpx deprecation warning
remains; no test failure is treated as a pass.

New coverage includes CRUD, pagination/order, persistence across a fresh app instance,
unchangeable scope, duplicate keys, conflicting keys, concurrent submissions, busy
rename/delete, failed generation, explicit retry, interrupted leases, reservation/final
transaction rollback, input/body/origin limits, corrupted snapshots, topic-history bounds,
fresh PostgreSQL retrieval, deleted/reprocessed citations and history injection boundaries.
Saved C2-only citations remain valid; an invented saved C99 beyond its original context
is rejected. Frontend cases cover reload, switching with late responses, send duplication,
network-key reuse, pending/failure states, stale/unavailable controls, citation navigation,
rename/delete confirmation, plain-text rendering and older-page ordering.

During implementation, a SQLite lease test exposed naive/aware datetime synchronization;
the conditional update was corrected and the suite rerun. Initial frontend effects
failed lint; keyed discussion views and asynchronous load callbacks resolved those errors.
Later formatting/import failures were corrected before the final passing gates. These
intermediate runs are not included in the pass counts above.

## Live saved conversation and persistence

Two disposable PDFs were uploaded, processed and indexed with real local
`nomic-embed-text`: a mixed safety-policy PDF and an independent garden-policy PDF.
Three task-owned conversations covered the main workflow and controlled comparisons.
No original user PDF was altered or reindexed. All live calls used `gemma3:4b` with the
existing 4,096 context / 512 response-token configuration.

The main safety discussion saved a question and contextual follow-up. Replaying the
same request key returned the same assistant UUID and did not add a second pair. All
four original message UUIDs survived an actual FastAPI process stop/start. The browser
loaded the saved messages, renamed the conversation, refreshed, and retained the title
and history. Later turns and a separate successful garden example were also persisted.

The final retained garden follow-up:

> User: Which of those are mandatory?
>
> Assistant: Gardeners must prune trees every morning. [1]

The earlier user question established the garden-club topic. The follow-up used fresh
retrieval from the garden document; the accepted reference points to its original page 1.
Manual synthetic-ground-truth review found **1/1 required fact, 1/1 relevant accepted
claim and no extra claims**. This simple example does not prove general reference resolution.

![Saved scoped contextual follow-up](screenshots/saved-conversation.png)

The screenshot contains only disposable synthetic records. The depicted discussion was
removed after verification. Browser refresh was separately observed to retain its messages.
The temporary browser tab was closed after the workflow.

## Follow-up accuracy: the harder case is not solved

The mixed-policy PDF said teams must attend safety training, must submit a prototype
report, and may attend optional workshops. The initial broad question returned all three
source-faithful statements. The mandatory-only follow-up still repeated the optional
statement; an optional-only follow-up also repeated the mandatory statements.

| Live accuracy check | Actual result |
| --- | --- |
| Broad mixed requirements | 3/3 known facts present; all quotes belong to the permitted PDF |
| Mandatory-only subset | 2/2 mandatory facts present, but only **2/3** accepted claims relevant to that subset |
| Optional-only subset | 1/1 optional fact present, but only **1/3** accepted claims relevant to that subset |
| One-fact garden follow-up, final retained code | 1/1 fact and 1/1 relevant claim |
| Unanswerable ceremony date | `insufficient_evidence`; no invented date |

A conversation-only prompt clarification and a question-last payload-order experiment
were tested. Neither improved the mixed subset results; **both were removed**. The
retained implementation has only the short topic/evidence separation instruction and
does not pretend to have a new semantic subset verifier. The existing M6 evidence-selection,
quote-validation and numerical policies remain. No larger model or context increase was used.

Source integrity, topic interpretation, subset relevance and factual support are different
measurements. The extra statements were genuine source quotes, yet did not answer the
narrower question. This remains an explicit limitation, not a successful precision test.
Earlier assistant prose was excluded from the model input; no historical assistant
claim was promoted to authoritative evidence. History/document-injection tests exercise
server scope and untrusted input boundaries with mocked generation. No general real-model
prompt-injection immunity is claimed for Milestone 7.

## Other live lifecycle checks

- A question body attempting to override document scope returned 422.
- Reprocessing the synthetic safety PDF made its old source-bearing messages `stale`.
  Stored IDs/excerpts were retained, without reassigning them to new chunks.
- After reindexing, a controlled provider failure used real PostgreSQL persistence and
  a mocked `chat_unavailable` model error. The assistant message was saved as failed,
  with no successful answer JSON. A new-key retry through real Ollama completed.
- Deleting the synthetic safety PDF made old citations unavailable. New questions
  returned 409 instead of retrieving from an unrelated collection/document.
- The browser showed the deletion confirmation, then deleted only the synthetic garden
  discussion. API and SQL checks found 404 and **zero child messages**, while its original
  synthetic PDF still returned HTTP 200.
- Cleanup removed only UUID-tracked test conversations, PDFs and collections. Public
  conversation/message tables returned to zero rows; the original library remained intact.

## Observed performance and resource limits

These are single-run **RAG-stage timings**, excluding the surrounding conversation-save
and historical-availability serialization work; they are not end-to-end latency promises.

| Probe | Retrieval ms | Generation ms | RAG total ms |
| --- | --- | --- | --- |
| Initial mixed requirements, cold sample | 172 | 36796 | 36968 |
| Initial contextual follow-up | 2172 | 2344 | 4547 |
| Mandatory follow-up during rejected prompt trial | 2219 | 10797 | 13047 |
| Optional follow-up during rejected prompt trial | 2156 | 2375 | 4531 |
| Unanswerable date | 109 | 547 | 656 |
| Garden direct question | 2188 | 9422 | 11610 |
| Garden follow-up during comparison | 2125 | 1266 | 3391 |
| Garden follow-up, final retained server | 2219 | 10156 | 12375 |

Cache state, cold loading, run order and output length vary. Small verification values
of 0 ms reflect timer resolution, not skipped source reads. No peak RAM/VRAM benchmark
was conducted. No SLA or general speedup is inferred. Stateless system text remains
1,024 UTF-8 bytes; follow-up separation adds 82 bytes (1,106 total) plus bounded topic JSON.
All stay within the same 3,456-byte input estimate, so history can reduce evidence space.

## Reproduction and manual checklist

Use the existing `.env`, installed models and volume. Apply the migration, then run the
standard checks from PowerShell (substitute your checkout path):

```powershell
Set-Location 'C:\Projects\ragvault\backend'
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic check
.\.venv\Scripts\python.exe -m pytest -m 'not postgres'
$env:RAGVAULT_TEST_POSTGRES='1'
.\.venv\Scripts\python.exe -m pytest -m postgres
Remove-Item Env:RAGVAULT_TEST_POSTGRES
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
.\.venv\Scripts\python.exe -m pip check
Set-Location ../frontend
npm.cmd test
npm.cmd run lint
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run build
Set-Location ..
docker compose --profile app config --quiet
docker compose --profile app build
```

For a manual replay, create a disposable PDF containing one clear requirement, then
upload/process/index it in a temporary collection. Open `/chat`, create a named document-
scoped conversation, ask about that requirement, then “Which of those are mandatory?”.
Inspect the original PDF page, refresh the browser, and restart only your development
FastAPI process. Reopen the discussion URL; verify the same messages remain. Rename it.
Reprocess/delete only that disposable PDF and refresh saved history to inspect stale/
unavailable notices and disabled page controls. Confirm that a deleted scope blocks new
turns. Use the confirmation dialog to delete the disposable discussion. Keep all real
library data and volumes. Standard automated tests reproduce failure/retry/rollback
without stopping the user's Ollama service.

- [x] Conversation/message models, constraints, ordering and additive migration.
- [x] Validated CRUD, pagination, immutable server-enforced scope and body bounds.
- [x] Durable pending/completed/failed pairs, idempotent duplicates and explicit retries.
- [x] Concurrent-turn, interrupted-lease and transaction-failure behavior.
- [x] Bounded user-question topics, fresh retrieval and no assistant-fact authority.
- [x] Persisted citation snapshots, current availability checks and honest stale states.
- [x] Sidebar, messages, scope, rename/delete confirmation and accessible existing citations.
- [x] Browser refresh, real API restart, live follow-up and deletion/cleanup verification.
- [x] Full tests, quality, build, Docker, migration, privacy and preservation checks.
- [x] Mixed-subset accuracy failure and unsuccessful experiments reported honestly.
- [x] No commit/push, production exposure, authentication claim or Milestone 8 work.

## Changed-file inventory

Modified existing files:

- `.env.example`
- `README.md`
- `backend/app/core/chat_limit.py`
- `backend/app/core/config.py`
- `backend/app/main.py`
- `backend/app/models/__init__.py`
- `backend/app/schemas/chat.py`
- `backend/app/services/citations.py`
- `backend/app/services/evidence_focus.py`
- `backend/app/services/llm.py`
- `backend/app/services/rag.py`
- `backend/app/services/rag_context.py`
- `backend/pyproject.toml`
- `backend/tests/test_llm.py`
- `frontend/package-lock.json`
- `frontend/package.json`
- `frontend/src/components/AppShell.tsx`
- `frontend/src/features/chat/ClaimAnswer.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/pages/ChatPage.test.tsx`
- `frontend/src/pages/ChatPage.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/types/chat.ts`

New files:

- `backend/alembic/versions/0004_conversations.py`
- `backend/app/api/conversations.py`
- `backend/app/models/conversations.py`
- `backend/app/schemas/conversations.py`
- `backend/app/services/conversations.py`
- `backend/tests/test_conversations.py`
- `backend/tests/test_chat_stabilization.py`
- `backend/tests/test_conversations_postgres.py`
- `docs/architecture/conversations.md`
- `docs/screenshots/saved-conversation.png`
- `docs/verification-milestone-7.md`
- `docs/milestone-7-stabilization.md`
- `frontend/src/features/chat/ConversationChat.test.tsx`
- `frontend/src/features/chat/ConversationChat.tsx`
- `frontend/src/pages/SingleQuestionChat.tsx`
- `frontend/src/types/conversations.ts`

The intended Milestone 7 change set contains 39 files. `.env`, original PDFs, database data, temporary scripts,
raw traces, logs, generated build assets and test databases are excluded. The new
documentation screenshot is an intentional synthetic demonstration, not a private upload.
The final candidate audit checks configured-secret matches, token/key patterns, personal
paths/emails, generated-data exclusions and this inventory without printing secrets.

## Remaining limits

Follow-up resolution is a bounded English heuristic; subset precision is demonstrably
imperfect. The unchanged small-model/context limitations still apply. Historical checks
validate source availability on load, not factual truth or permanent consistency. Interrupted
turns can remain pending until their lease expires; there is no automatic model retry or
persistent queue. The interface polls active turns and may show transient connection
errors during a deliberate API restart; refresh after reconnecting. Local database history
is private, unencrypted and unauthenticated. No multi-user, streaming or production-ready
access controls are implemented. GitHub Actions has not run for these uncommitted changes.
