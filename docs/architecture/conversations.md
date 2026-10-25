# Milestone 7: persistent scoped conversations

The existing retrieval, Gemma quote-selection contract, citation validator and PDF
library are reused. `/api/chat` remains stateless. `/api/conversations` adds persistence
around the same RAG engine. There is no authentication, streaming, background queue,
external model, long-term semantic memory or Milestone 8 redesign.

## Relational design and scope

`conversations` has a UUID, validated title (1–120 visible characters), optional collection
and document foreign keys, immutable copies of the original scope UUIDs, UTC created/
updated timestamps, the next message position and a bounded active-request lease.
Indexes cover foreign keys and `(updated_at, id)` listing order.

`messages` has UUID and conversation FK, request UUID, requested top-K, positive position,
user/assistant role, pending/complete/failed lifecycle, bounded content, optional structured
answer JSON, safe error code and UTC creation timestamp. Unique constraints enforce
`(conversation_id, position)` and `(conversation_id, request_id, role)`. Positions, not
timestamp ties, establish stable ordering. Assistant creation time is its reservation time.

The additive `0004_conversations` Alembic migration creates only these two tables. It
does not rewrite library rows or touch uploads/vectors. Apply `alembic upgrade head`
explicitly; startup does not migrate automatically. The downgrade drops saved history
and must not be used casually on retained data.

Conversation deletion cascades to messages only. Collection/document deletion uses
`SET NULL` on relational FKs but **retains immutable scope IDs**. This separates referential
cleanup from authorization: a missing original scope returns 409 on new turns, rather
than turning a document-scoped discussion into an all-documents discussion. Historical
messages remain readable. Scope cannot be patched or overridden in a question body.

## API

| Endpoint | Behavior |
| --- | --- |
| `POST /api/conversations` | Optional title, collection UUID, document UUID; validate existence and membership |
| `GET /api/conversations?limit=20&offset=0` | Newest updated first, UUID tie-break; max 100 |
| `GET /api/conversations/{id}` | Title, original scope IDs/label, availability and generating state |
| `PATCH /api/conversations/{id}` | Rename only; active turns block mutation |
| `DELETE /api/conversations/{id}` | Delete discussion/messages; active turns block deletion |
| `GET /api/conversations/{id}/messages?limit=20&offset=0` | Offset from newest, return each page oldest-to-newest; max 50 |
| `POST /api/conversations/{id}/messages` | Question, required request UUID and optional top-K; return saved user/assistant pair plus duplicate flag |

Titles, question text, UUIDs, pagination and unknown fields are validated server-side.
Successful conversation responses use `Cache-Control: no-store`. Browser cross-origin
writes remain rejected; native local clients without Origin remain supported. Invalid
conversation requests receive generic 422 errors without reflecting private inputs.
Missing valid IDs return 404; scope mismatch is 422, unavailable original scope is 409.
Both chat APIs have a 16 KiB JSON body bound, including chunked bodies and unknown fields.

A saved assistant message includes the answer status (`answered`, `partial`,
`insufficient_evidence`, `unreliable`), source/claim metadata and timestamps. Message
`status` is separate: `complete` means a response was saved, **not that it is correct**.
Even an insufficient-evidence response can be a completed saved turn. A generation
failure has `status=failed`, no answer JSON and a fixed safe message/error code.

## Durable lifecycle, duplication and recovery

1. Validate the immutable scope. Check whether the request UUID already has a saved pair.
2. Atomically claim an idle conversation using an SQL compare-and-swap on active request
   and next position. This works across API processes; it is not an in-memory-only lock.
3. In the same short transaction, allocate two positions and insert the complete user
   message and pending assistant message. Commit before retrieval/generation.
4. Release read transactions while Gemma runs. The existing RAG admission, deadlines and
   fresh source checks before/after generation remain active.
5. Conditionally clear only this request's lease and save the complete or failed assistant
   state in one transaction. A timed-out worker cannot overwrite a newer request.

Repeating the same key/question/top-K returns the existing pending, failed or completed
pair and never generates again. Reusing the key for different content/top-K returns 409.
Concurrent distinct submissions to the same conversation return 409. Concurrent duplicate
arrival during the reservation race may also receive 409 and should refresh/replay its
key; it cannot produce two successful generations. Rename/delete wait for the active turn.

Retrying a known failed generation is an explicit **new turn with a new key**; old failures
stay visible. A client with an uncertain transport outcome resubmits the same key. After
refresh, inspect saved messages before deciding to issue a new turn. Keys are scoped to
one conversation. Browser memory is not the source of truth for completed messages.

If reservation commit fails, neither half-turn is durable. If the final commit fails,
the API returns 503 `turn_save_failed`; it does not return an unsaved successful answer.
The durable pending pair remains recoverable. A pending lease expires after configured
generation timeout + embedding timeout + 60 seconds (default **300 seconds**). Reading
conversation details/messages or submitting another turn lazily marks an expired pending
assistant as failed and releases its lease. Recovery can therefore update state on a GET.
A server restart alone does not immediately cancel a lease that another worker might own.
There is no automatic replay of an interrupted model call or persistent worker queue.

## Bounded follow-up strategy

Simple English reference/subset cues select bounded topic history. Defaults:

| Setting | Default / meaning |
| --- | --- |
| `CONVERSATION_HISTORY_MESSAGES` | 4 prior user questions whose assistant turn completed; 0 disables |
| `CONVERSATION_HISTORY_CHARS` | 600 total characters; at most 300 per question; 0 disables |
| `CONVERSATION_MAX_MESSAGES` | 500 rows / up to 250 question-response pairs, including failures |

The current question plus the bounded topic strings form a search query, capped at
2,000 characters. Fresh pgvector retrieval always uses server-owned scope. The original
question still reaches Gemma, with a narrow resolved category topic when applicable;
previous questions are placed in a separate
`untrusted_conversation_topics` JSON field, not mixed into `untrusted_sources` or role
messages. A short system instruction explicitly limits topics to resolving references.
**No prior assistant statement, citation snapshot or hidden system prompt is supplied.**

This is deterministic topic expansion, not an LLM query rewriter. It can miss references,
lose an older topic after the history window, or retain irrelevant prior questions. A
completed abstention is not a new evidence fact. The policy never treats a recalled
question as proof that an assertion is true. Model subset selection remains imperfect:
the mixed mandatory/optional live probe repeated extra source-valid statements.

`its` is included among reference cues. For a category reference, the latest applicable
unambiguous user category also guides context packing and relevance checks; intervening
explicit unrelated or ambiguous topics prevent that category shortcut. A possessive
page-limit question with no category antecedent asks for clarification. These are bounded
English heuristics, not general reference or semantic verification.

The existing 4,096 context / 512 response-token limits, 3,456 estimated input bytes,
6,000 serialized context characters, 1,600 characters per passage, relevance threshold,
focused evidence priority and timeouts remain. History and its extra instruction count
inside the same byte budget and may displace PDF context. No unlimited transcript is
concatenated; there is one generation and no added model/reranker. Maximum user input is
2,000 characters; stored content is bounded at 12,000 (normal answer cap remains 4,000).

## Citation snapshots and historical availability

Accepted claim text, its checked citations, referenced-source metadata, answer status,
models/dimensions, timing and verification summary are saved. When no claims are accepted,
up to two source-checked 600-character original excerpts may be saved as a separately
labelled `evidence_fallback`, never as accepted claims. Their metadata, alias bounds and
current source availability are checked just like displayed quote sources. Other unused passages,
rejected model statements, raw prompts/provider errors, PDF binaries and vectors are not
copied into messages. The existing response gains optional `embedding_dimensions` to
check the saved embedding provenance; it contains no actual embedding values.

Stored answers are validated again against typed schemas and bounded sizes. Metadata,
source IDs, alias/number consistency and reference membership are checked. The existing
source verifier reloads referenced chunks/metadata/index eligibility and checks scope,
page, original excerpt, model and dimensions. Historical aliases need not be contiguous:
an answer might cite only C2. The stateless/generation path still requires its original
ordered C1..Cn context. Unknown aliases never drive arbitrary database queries.

| Message citation state | Meaning / interface |
| --- | --- |
| `available` | Original source metadata/text/index are available on this load; page controls enabled |
| `stale` | Chunk replaced, metadata/index changed or source check failed; retain snapshot, disable page controls |
| `unavailable` | Original document/scope deleted; retain snapshot, disable page controls |
| `invalid` | Stored snapshot cannot be validated; no active answer/citation controls |
| `none` | No saved source-bearing answer, including pending, failed or abstention turns |

Historical answers use verification status `not_run` and an explicit historical notice,
even when sources are available. They are not presented as freshly factually verified.
`factual_support` remains `not_established`. There are no invented replacement citations.
Reprocessing creates new chunk IDs; old references do not silently rebind to them.
Availability is a read-time snapshot, not a lock through a later PDF click. Files are not
reparsed/checksummed on every read; external disk/DB edits remain outside this guarantee.

## Interface, security and known limits

The existing design gains a paginated conversation sidebar, new/rename/delete controls,
confirmation, fixed scope indicator, user/assistant bubbles, scrollable message history,
older-message loading, pending/failure messages and explicit retries. URL query state
selects a conversation after refresh. Switching remounts the discussion view and cancels
stale client loads; a late response cannot replace another discussion. Pending turns poll
at five-second intervals. Disconnecting the client does not cancel a durable server turn.
The original screen remains at `/chat?mode=single` with its earlier tests preserved.

Submission immediately shows a local user/pending pair, reconciled by request UUID.
The flexible message pane follows new content only while near its bottom. Manual upward
scrolling preserves reading position; Jump to latest resumes following. Older-page loading
preserves the prepend anchor. Enter submits (outside IME composition), Shift+Enter adds
a newline. The composer stays outside the scrolling transcript, and repeated technical
diagnostics remain available in disclosures. See the
[stabilization report](../milestone-7-stabilization.md) for current tests and GIQ results.

Messages, titles, quotes and prior topics remain untrusted. React renders plain text,
not model HTML/Markdown or arbitrary generated URLs. The model has no tools, files,
credentials or SQL access. Origin/host restrictions and server-side scope remain in force.
Prompt injection can still affect prose/relevance; it cannot legitimately expand scope
or invent accepted IDs/pages. Passing source checks is not semantic verification.

This is local, single-user, single-worker development software. Conversation records
contain private questions and PDF excerpts in the existing unencrypted database volume.
Deleting a conversation is permanent through the app and does not erase private external
backups. Do not publish the database, uploads, `.env` or raw investigation files. No
authentication, multi-user permissions, distributed generation admission, streaming or
advanced model selection is claimed. See [Milestone 7 verification](../verification-milestone-7.md)
for actual tests, live accuracy, failed experiments, screenshots and the completion checklist.
