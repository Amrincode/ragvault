# Milestone 7 stabilization: chat interaction and answer reliability

Verified locally on 25–26 October 2026. The stabilization checkpoint made no commit or push;
publication was approved separately on 26 October. Milestone 8 has not started.
This supplements [Milestone 7 verification](verification-milestone-7.md)
and retains the earlier mixed mandatory/optional follow-up limitation.

## Changes retained

- A submitted question appears immediately beside an assistant pending bubble. Local
  pending feedback is reconciled by request UUID with durable server messages.
- The message pane follows submission and completion while the reader is near its
  bottom. Scrolling upward stops following; **Jump to latest** resumes it. Prepending
  older messages preserves the reading anchor. Switching discussions resets the view
  and cancels stale client loads.
- A bounded, flexible message panel keeps the composer below the scrolling transcript.
  Chat uses compact shell spacing; other screens retain their existing spacing. Enter
  sends, Shift+Enter inserts a newline, and composition events do not submit.
- User/assistant/pending/failed states remain distinct. Transport uncertainty keeps
  the local question visible and offers the existing same-key recovery action. Known
  failed turns retain their separate new-turn retry behavior.
- Repeated availability and verification diagnostics are collapsed into accessible
  disclosures. Citation buttons, original PDF navigation, partial-answer notices and
  factual-verification limitations remain available.
- `its` now triggers bounded completed-user-question history. A narrow category cue
  from the most recent applicable user topic also reaches context priority and claim
  relevance checks. It never changes document/collection scope or adds assistant facts.
- For explicit category/report questions, context can start at that category's explicit
  heading and stop at the next category or presentation deliverable. This is a contiguous
  substring of the retrieved passage, with its original chunk/page/IDs. The greedy
  packing algorithm, model and limits remain unchanged.
- A nonnumeric quote need not repeat its category name if every occurrence is within
  that explicitly headed category section. Ambiguous duplicated items remain withheld.
  Report questions also require the quote to belong to a report section, avoiding the
  prototype-versus-report error found during an intermediate trial.
- Distinct model-selected quotes grouped in one selection become independent extractive
  claims. Each keeps its own alias and unchanged text and passes the existing validator.
  Duplicates are collapsed; output is capped at six claims and marked partial if clipped.
  There is no alias repair, quote rewriting or numeric qualification added by the app.
- No usable context, model abstention with retrieved context, and rejected generated
  claims receive distinct explanations. An unresolved possessive page-limit question
  asks which report/category is intended rather than accepting an arbitrary category.
- When no claims are accepted, up to two source-checked original excerpts, at most
  600 characters each, can be opened under **Retrieved source excerpts · not an answer**.
  They are not accepted claims or verified facts and may be irrelevant or truncated.
  Saved fallback metadata/text is checked on reload; stale/deleted sources disable links.

Numeric category qualifiers, original numbers/negations, conflict checks, source-ID/page
binding, exact or whitespace-only quote matching, origin/body limits, immutable filters,
prompt/data separation and injection protections remain. The model still has no tools,
credential access, assistant-fact memory or authority to widen retrieval scope.

## Investigation method and root causes

The same four questions were run before and after against the original, unchanged
`GIQ-2026-Brief.pdf`, all collections with that document filter, top-K **5**:

1. What should students include in their project report?
2. What is the maximum page count for the advanced category?
3. What are the advanced category project report requirements?
4. What is its maximum page count?

Each set ran through stateless `/api/chat`, a separate fresh saved conversation for
each question, and one saved conversation containing questions 1–4 in sequence. A fresh
or stateless question 4 intentionally has no antecedent. Five disposable conversations
per phase were removed afterward; user conversations were not altered.

Private ignored traces captured search requests, all ranked passages/similarities,
packed prompt/source objects and byte usage, raw Ollama structured output, parsed
selections, validation decisions, timings and saved presentation. Saved snapshots
intentionally omit rejected model text, so raw decisions were also evaluated from
the trace. Raw PDF text, prompts, private UUIDs and provider bodies are not in this report.

**Question 1:** The baseline reproduced three accepted source-valid report items, not
the previously reported total withholding. Two relevant report chunks already reached
Gemma. Output remains incomplete and can mix category material for an unspecified
category. There is no claim that every earlier stochastic result was reproduced.

**Question 2:** The advanced report paragraph was retrieved at rank 4 and promoted to
context C1, including the 40-page statement. Gemma selected a fragment without the
category heading, a non-answer report fragment and/or presentation-duration material.
These were correctly withheld for missing numeric qualification, wrong field or bad
quotation. This is not absent evidence and not simply the context budget. The retained
implementation still withholds this direct question in all three modes. A separately
labelled original-source fallback makes the evidence inspectable without claiming an answer.

**Question 3:** The relevant report passage ranked first and reached the model, but the
old category relevance rule required the label inside every list item. Correct verbatim
items beneath the advanced heading were rejected. Grouped distinct quote selections
also incorrectly required the first quote to appear in every other selected quote.
The focused section and independent-selection changes address these false rejections.
An intermediate trial accepted an advanced prototype statement for a report question;
the final report-section guard rejects that failure pattern.

**Question 4:** The old reference regex matched `it` but not `its`; no prior topic entered
search, packing or relevance checks. The advanced report was rank 5 (similarity 0.541),
and the budget was consumed by starter/other passages. The final related query adds the
three preceding user questions as topics: the advanced report rises to rank 1 (0.743)
and reaches C1. Gemma's advanced 40-page quote passes; a starter 20-page quote is withheld.
With no applicable antecedent, the application now requests clarification without generation.

## Budget and safeguards

The configured model remains `gemma3:4b`; embeddings remain `nomic-embed-text`. Context
is still **4,096 tokens**, response **512 tokens**, with the same conservative **3,456
UTF-8 input-byte** estimate, framing reserve, **6,000** serialized context characters
and **1,600** per passage. These byte estimates are not measured tokenizer counts.
Every captured generated prompt stayed within the byte cap. No larger model/window,
metadata compaction, extra generation, reranker or re-embedding of the user's PDF was used.

Packing remains greedy after focused stable priority, with prefix truncation. History,
JSON and metadata consume the same budget as PDF text. Selected counts were two or three,
despite five retrieved hits. Before the fix, question 4 filled 3,456 bytes without the
advanced report; afterward its two selected passages used 3,321 bytes. For question 3,
the focused advanced substring is 768 characters rather than the mixed 1,114-character
chunk; three sources fit, but extra sources still do not guarantee relevant output.
Only top-K evidence is considered; missing sections outside it cannot be recovered.

A trial instruction demanding category headings did not fix the direct page-limit
failure and reduced broad-answer coverage in some runs. It was removed. The retained
system prompt is the existing prompt plus the original Milestone 7 history/data notice.
Numeric fragment checks were preserved instead of accepting an unqualified number.

## Measured GIQ results

Each cell is **before → retained**, with accepted claim count in parentheses. `partial`
and `answered` describe model/validation state, not exhaustive factual correctness.

| Question | Stateless | Fresh saved | Related saved sequence |
| --- | --- | --- | --- |
| 1 report contents | answered (3) → answered (3) | answered (3) → answered (3) | answered (3) → answered (3) |
| 2 advanced page limit | unreliable (0) → unreliable (0) | unreliable (0) → unreliable (0) | unreliable (0) → unreliable (0) |
| 3 advanced report requirements | unreliable (0) → partial (3) | unreliable (0) → answered (4) | unreliable (0) → answered (4) |
| 4 possessive page limit | unreliable (0) → clarification (0) | unreliable (0) → clarification (0) | unreliable (0) → partial (1) |

- Cases with accepted claims: **3/12 → 7/12**. Total accepted claims: **9 → 21**;
  withheld selections: **27 → 10**. Selection grouping changes the number of independent
  claims, so this is not a controlled population-wide accuracy estimate.
- In the three advanced-report baseline responses, **9 correct nonnumeric quote items
  were falsely rejected** for category wording. The final advanced-report selections
  had **0 observed false rejections** under the narrow section contract (3/4/4 accepted).
  Safely rejected unqualified numbers and bad references are not counted as false rejections.
- Manual review found **0 incorrect accepted claims in the retained 12-case sample**.
  The related starter limit was rejected. This is a small observed sample, not a general
  factual-verification guarantee; earlier mandatory/optional relevance failures remain known.
- Advanced report completeness remains **2 of 7 enumerated items** in the stateless
  run and **3 of 7** in the two saved runs, plus the qualified page-limit statement.
  A successful status is not proof of completeness. The direct page-limit question is
  still 0/3 accepted answers; fallback excerpts are excluded from accuracy totals.
- Median nonzero generation time: **2,953 → 3,914.5 ms**. The first question took
  **11,375 → 11,562 ms**; related page-limit follow-up **3,407 → 3,234 ms**. The two
  no-antecedent cases now skip generation (0 ms). Median retrieval **109 → 94 ms**.
  Caches/loading and output lengths differ; there is no demonstrated overall speedup
  or controlled memory benchmark. The existing small-model resource limits were retained.

## Automated and browser verification

| Check actually run on retained code | Result |
| --- | --- |
| `pytest -m "not postgres"` | **314 passed**, 21 deselected |
| `RAGVAULT_TEST_POSTGRES=1 pytest -m postgres` | **21 passed**, 314 deselected |
| Frontend Vitest, all nine files | **78 passed** |
| Ruff lint and format check | Passed, 67 Python files |
| `pip check` | No broken requirements |
| ESLint, Prettier, TypeScript | Passed |
| Production `npm run build` | Passed |
| `npm audit --json` | 0 known vulnerabilities, including dev dependencies |
| Compose configuration validation | Passed |
| PostgreSQL, backend, frontend Docker builds | Passed; final frontend spacing rebuilt |
| Built backend smoke | Health, database, Ollama, saved citations and Alembic current/check passed |
| Built frontend smoke | Nginx configuration and `/chat` HTTP serving passed |
| Alembic on retained PostgreSQL | `0004_conversations (head)`; no new upgrade operations |
| Existing PostgreSQL / named volume | Healthy; same existing volume and cluster |

The new synthetic tests cover heading-qualified and ambiguous items, both categories,
correct/wrong numbers, invented aliases, paraphrases, absent injected claims, wrong
deliverables, grouped quotes and bounded output, `its`/`those` references, clarification,
empty evidence versus rejected claims, saved fallback/stale citations and external-document
isolation. PostgreSQL tests upload/process/index disposable PDFs in isolated schemas;
model outputs/embeddings there are controlled. They are not real-model accuracy tests.
The original PDF management, processing, search, citation and conversation suites remain.

Frontend regressions cover immediate feedback, loading/completion, Enter/Shift+Enter,
scroll-follow versus manual position, jump-to-latest, prepend anchors, switching/stale loads,
uncertain-network key reuse, errors/retries and escaped fallback text/citation navigation.

Real in-app browser verification used an agent-owned tab, a disposable synthetic PDF and
two conversations. Enter submission showed both local bubbles immediately; the scoped
report answer and 40-page follow-up displayed source citations. Scrolling to the top
while generation ran stayed at `scrollTop=0` after completion; Jump to latest reached
the bottom. Switching returned to the correct transcript at its bottom with the composer
visible. Original PDF page 1 rendered from a citation. A fresh possessive question showed
clarification and the separately labelled fallback; both persisted after refresh.
Desktop checks used a 1,280 × 720 viewport. Narrow-device emulation was not available
through this browser interface, so no real-device/mobile verification is claimed.
Failure/transport recovery was exercised by automated tests without interrupting user services.

The existing Starlette/httpx deprecation warning remains. Python dependency compatibility
was checked; no separate Python vulnerability database audit was performed. GitHub Actions
had not run at the stabilization checkpoint because publication was not yet authorized.
The subsequent approved publication checks are recorded in the Milestone 7 verification report.

## Privacy, preservation and review

Candidate tracked/unignored files and reachable `main` history were scanned without
printing configured secret values. Local credentials, personal Windows paths/emails,
private key/token patterns, raw GIQ material and generated-data paths are excluded.
The final audit covered **168 candidate files**, **8 main-history commits** and **258
history blobs**, with **0 findings**. Seven representative ignored-path categories
were checked explicitly; no files are staged, and the documented 39-file inventory matches Git.
`.env`, uploads, database files, virtual environments, logs, scripts, raw traces, build
output and test databases remain ignored. The earlier synthetic documentation screenshot
is intentional project documentation; new browser proofs remain in ignored `.artifacts`.

Before/after digests compare all six existing application tables, `.env`, every upload,
PostgreSQL cluster identity and Docker mounts. Only task-owned conversations, synthetic
PDFs/collections and isolated test schemas were cleaned up. No original document,
user conversation, database volume, configuration or Git history was changed.

At the stabilization checkpoint, the work remained uncommitted and unstaged. No migration
downgrade, volume deletion, new product milestone or unrelated functionality change was performed.
Publication is a separate approved step documented in the Milestone 7 verification report.
