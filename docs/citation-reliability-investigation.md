# Milestone 6 real-world citation reliability investigation

25 October 2026. This follow-up supersedes the initial Milestone 6 output contract,
prompt/selection description and verification counts. The initial measurements remain
in [the milestone report](verification-milestone-6.md) as a historical snapshot.
This investigation records the prepublication state; the milestone report's publication
verification section records the later full test rerun and preparation for the approved commit.

## Method and privacy

The user confirmed **top-K 5** for all three reported questions. Each was reproduced
against the existing indexed `GIQ-2026-Brief.pdf`, with all collections and that document
filter. The investigation captured actual retrieval rankings, selected context, aliases,
model selections, decisions and timings. Raw private text and model traces stay only
in ignored local investigation files; they are not candidates for publication. The
original PDF was not modified, processed again or reindexed.

Before/after real-model runs used the installed `gemma3:4b` and `nomic-embed-text`.
No larger model, new dependency, reranker, retry loop or context-limit increase was used.
The old pending-M6 implementation was privately frozen before edits for controlled
validator/context comparisons. No commit, branch, recovery ref or remote was changed.

There are three distinct evaluations below: fixed validator decisions, live synthetic
PDF answers, and private-document replays. They have different denominators and cannot
be combined into a single accuracy or factual-verification score.

## Root cause: report requirements

Question: “What should students include in their GIQ project report?”

Before, retrieval ranked a general goals/guidelines chunk on PDF page 5 first, followed
by report content on page 8 and page 7. Greedy packing sent **1,176 characters of page 5**
and only **632 of page 8**, excluding page 7. System/user content exactly filled the
**3,456-byte** application packing cap. Useful report content was nevertheless supplied.

All three generated claims were withheld, for different reasons:

- The problem-statement sentence was a reasonable paraphrase of a cited list item.
  Full sentence containment failed because the model added a subject and preamble.
  This was a genuine conservative wording false rejection.
- The introduction sentence also paraphrased the list, but changed its modality to
  “may include.” A required-content list does not establish that the item is optional.
  This should not be counted automatically as a fully supported paraphrase.
- The generic 40-page assertion omitted the Advanced category qualification. The
  number existed in supplied evidence, but treating it as an unrestricted report limit
  would lose an essential qualifier. Relaxing matching to accept any shared number
  would hide this error.

This was a combination of poor evidence priority, limited coverage and the mismatch
between free-form claim prose and the conservative extractive validator. It was not
simply missing all relevant evidence or a two-passage model limit.

## Root cause: Advanced page limit

Question: “What is the maximum page count for the advanced category report?”

The first retrieved chunk contained the Starter report limit (page 7); the second was
presentation material on page 8; the third contained the Advanced report clause on
page 8. All three entered context, with the third truncated to **420 characters**.
The correct 40-page clause was still present: lack of evidence was not the immediate
reason for this rejection.

The generated Advanced report quote pointed to **C2**, the presentation passage,
instead of **C3**, the passage actually containing it. The validator correctly rejected
`quote_mismatch`. It must not search elsewhere and silently rebind that quote. Another
presentation claim changed sentence case and was also irrelevant to report page count.

Meanwhile, the Starter 20-page sentence was a valid quote of C1. The old validator
checked source/wording integrity without checking the explicit requested category or
numeric field. It therefore displayed a source-valid but wrong-answer statement.
Citation validity did not imply answer relevance.

## Root cause: participation requirements

Question: “What are the project participation requirements?”

Context contained page 10's sponsor/bootcamp passage and 680 characters from page 8's
report passage. Both the bootcamp percentage and the Advanced report limit were present.

The sponsor permission passed because it was verbatim. It is an optional allowance,
not an obligation; quoting it does not provide a complete list of participation rules.
The bootcamp-percentage claim added a final period to a quote ending before a conjunction.
That punctuation alone caused the numerical wording rejection: a genuine false rejection.
The report claim added punctuation and omitted its category. The category omission
should remain protected even when the value itself is correct for Advanced reports.

The broad question also retrieved other participation material that did not fit. Its
answer cannot be considered complete merely because some supplied quotes pass checks.

## Retained targeted changes

1. **Quote selection instead of duplicated claim prose.** The model-facing JSON now
   contains status and `claims[].citations[]` with `citation_id` and `quote`. It cannot
   supply an independent `text` field. The application derives the internal answer
   claim from the first selected quote, then validates all references. Extra free-form
   text is rejected rather than silently replaced. The public claim/citation fields
   remain available. This prevents a valid quote and a separately paraphrased claim
   from disagreeing by construction; it does not prove the quote answers the question.
2. **Narrow formatting tolerance.** The independently testable wording matcher tolerates
   one final display period. It does not delete negation, list content, parentheses,
   category labels, digits or interior punctuation. Quote matching remains exact or
   whitespace-only; changed list markers, spelling, case and wrong aliases still fail.
3. **Focused stable priority before existing greedy packing.** For report-content
   questions, retrieved sections saying the report should/must include content precede
   generic aims. For a single explicit category/page-limit query, the matching category's
   page clause precedes near-tied other-category and presentation passages. This works
   only within the already retrieved top-K, preserving filters, source text and all caps.
4. **Explicit scope diagnostics.** A source-valid claim that misses the requested
   category or page field is withheld as `relevance_not_established`. Numeric fragments
   must retain category labels from the same source sentence, including labels preceding
   the selected quote. The UI explains this separately from quote/wording failure.

These English lexical checks are bounded heuristics. Compound/comparison questions,
different phrasing and broader relevance are not generally understood. No claim is
labelled factually verified; `verification.factual_support` remains `not_established`.
Existing invalid-ID/page/scope checks, numerical conflict detection, injection boundaries,
inert rendering, one-generation admission and no-general-knowledge fallback remain.

A prompt-only attempt was **not retained**: stronger copy instructions still produced
paraphrases and worsened the Advanced result to no accepted answer. A quote-only trial
then exposed a different failure: correctly quoted general aims answering a report
question. That observation justified the focused report-section priority. The final
sample below includes remaining failures, rather than choosing the best intermediate run.

## Fixed validator evaluation

The committed [14-case fixture](../backend/tests/fixtures/citation-validation-cases.json)
defines five supported, relevant, properly referenced cases and nine unsafe/off-topic
cases. “Supported” here is manually assigned synthetic ground truth, not a runtime label.

| Fixed decision metric | Before | Final |
| --- | --- | --- |
| Supported cases accepted | 3/5 | 4/5 |
| Supported cases rejected | **2/5** | **1/5** |
| Unsafe/off-topic cases accepted | **3/9** | **0/9** |

The remaining false rejection is a valid paraphrase. The independent verifier still
does not establish semantic entailment; real generation avoids that separate prose
field instead of approving paraphrases through approximate similarity. Before's three
problematic acceptances were a wrong category, the wrong numeric field, and an
unqualified category-specific numerical fragment. Wrong aliases, fabricated IDs,
altered numbers, negation changes, missing evidence and permission-to-obligation changes
remain rejected. The fixtures also retain multiple-source and line-wrap coverage.

## Live known-answer disposable PDFs

Twelve real uploaded/processed/indexed synthetic PDFs were used: the prior nine-case
fixture plus [three realistic failure-pattern PDFs](../backend/tests/fixtures/citation-reliability.json).
All were document/collection-filtered. Before and final used top-K 5 and identical
generation/context limits. Standard PostgreSQL regression tests separately mock the
models; these live measurements used the installed real models.

Expected groups are counted only when all relevant terms occur within an accepted
claim, preventing a correct number in a different category from earning credit.

| Case | Expected facts before | Final | Final behavior |
| --- | --- | --- | --- |
| Report contents | 1/2 | 2/2 | Answered; correct source list items |
| Advanced page limit | 1/1 | 1/1 | Partial; only Advanced 40-page limit accepted |
| Participation | 1/2 | 1/2 | Partial; bootcamp percentage accepted, category-omitting report fragment withheld |
| Direct date | 1/1 | 1/1 | Answered |
| Exact team-size categories | 2/2 | 2/2 | Answered; categories preserved |
| Broad requirements | 3/4 | 4/4 | Partial; both categories' known facts present |
| Partial budget/date | 1/1 | 1/1 | Partial; unspecified date preserved |
| Unanswerable date | — | — | Insufficient evidence; abstained |
| Two-page report limits | 2/2 | 2/2 | Answered; correct pages |
| Conflicting sizes | — | — | Unreliable; definitive numerical claims withheld |
| Embedded instructions | 1/1 | 1/1 | Retention fact; no injected success marker |
| Fake citation instruction | 1/1 | 1/1 | Retention fact; no injected success marker |
| **Total expected fact coverage** | **14/17** | **16/17** | One qualified participation-report fact remains missing |

Before there were **19 accepted entries and 6 withheld**; final had **16 accepted and
5 withheld**. Fewer accepted entries did not mean less coverage: final's two broad
quotes covered four expected facts. Manual relevance review identified two off-target
entries in the scoped Advanced answer before (Starter limit and generic report-content
detail), plus a participation report value missing its category. None of these three
problematic acceptances remained in final. No source-inconsistent numerical value was
accepted in either small live synthetic sample; this is separate from scope/relevance.

All accepted references matched the known original PDF pages. Unknown references were
not rebound or repaired. Conflict, insufficient-evidence and both injection probes
retained their safe behavior. These twelve cases do not establish general immunity,
semantic correctness, completeness or a real-world false-rejection rate.

## Final private-document replay and remaining problems

| Question | Before | Final actual result |
| --- | --- | --- |
| Report contents | All three claims withheld | Partial: two report-content list items accepted; one changed list marker rejected |
| Advanced page limit | Starter 20 displayed; 40 rejected | Partial: Advanced **40** displayed; Starter and irrelevant footer selections withheld |
| Participation | Sponsor permission only | Partial: sponsor permission and bootcamp entry information; report quote still rejected for mismatched source alias |

The final report answer omitted the background-research item even though it was
available. The participation answer did not include every requirement or the earlier
bootcamp-percentage statement. These omissions are **not solved** by source matching.
All five accepted final entries matched stored source wording; the optional sponsor
permission remains adjacent information, not a mandatory participation requirement.
The final replay had no wrong-category page limit, but it was not a complete answer.

Current report and page-limit contexts are the full supplied report chunks from pages
8 (1,114 characters) and 7 (471), using 3,373 and 3,380 bytes respectively. Participation
still receives page 10 plus a 536-character page-8 prefix and fills the 3,456-byte cap.
The expanded prompt is 1,024 bytes versus the initial 874; that leaves less evidence
space on unchanged packing limits, a measured trade-off rather than a budget increase.

A retrieval-only top-K 10 probe still packed only two final passages for every question,
with the same page choices. Top-K alone therefore does not resolve coverage. Prefix
truncation, bounded output, missed context and model quote-selection mistakes remain.
No attempt was made to normalize a wrong list marker or to reassign an incorrect alias.

## Latency

| Measurement | Before | Final |
| --- | --- | --- |
| GIQ report generation / total ms | 12203 / 14468 | 5844 / 8078 |
| GIQ Advanced generation / total ms | 4640 / 6828 | 3672 / 5875 |
| GIQ participation generation / total ms | 3938 / 4391 | 3422 / 3531 |
| Twelve synthetic cases: generation median ms | 2328 | 2562 |
| Synthetic generation median excluding first case | 2000 | 2515 |
| Synthetic total median ms | 2445.5 | 2718.5 |
| Synthetic verification median ms | 15 | 31 |

The synthetic all-case generation median increased about **10%**; excluding the first
case it increased about **26%**. Private-document median generation decreased from
4,640 to 3,672 ms. These are sequential, single-pass samples with different output lengths,
caching and cold-start effects, not a controlled throughput benchmark. The first
synthetic generations were 10,360 versus 5,625 ms. Timer resolution and concurrent test
work affect small verification timings; do not interpret 0 ms as skipped source reads.
No peak-RAM/VRAM benchmark or latency guarantee is claimed.

## Final verification and preservation

Final complete regular backend run: **274 passed**, 17 PostgreSQL cases deselected,
238.03 seconds, with the CI-style password inherited in that test process.
PostgreSQL/pgvector: **17 passed**, 274 regular cases deselected, 159.89 seconds,
including all three disposable-PDF regressions. Total backend coverage: **291 cases**.
Frontend: **57 passed** across eight files; ESLint, Prettier, TypeScript and production
build passed. Ruff lint/formatting passed (64 Python files); `pip check` found no broken
requirements. Compose configuration and updated backend/frontend Docker builds passed.

An early restricted test invocation could not create its default temporary directory;
a later restricted PDF-processing run stalled and was stopped. Normal local subprocess
access with task-owned temporary directories resolved the environment limitation.
The first new PostgreSQL report test also exposed a mock's incorrect assumption that
PDF extraction preserves list-item line breaks. The mock was corrected to select known
source wording, then the entire PostgreSQL suite passed. These failed/interrupted runs
are not counted as passes. The existing Starlette/httpx deprecation warning remains.

Only twelve task-owned synthetic PDFs and their collection were removed. Final private
fingerprint comparison confirmed all original rows in the four public application tables,
original uploaded file bytes (including GIQ), `.env`, cluster identity and named
`ragvault_postgres_data` volume unchanged. Alembic remains at `0003_semantic_search`,
with no pending model/schema operations. No migration or application limit was changed.

Final privacy/candidate scans reviewed **152 files** with no configured-secret,
credential-pattern, unintended-artifact, personal-path or private-email findings.
Ignore probes passed for `.env`, virtual environments, uploads, caches/build outputs
and `.artifacts`. All **34 pending files** match this report's inventory; the index is
empty and `main` remains at `76b2c80944f41991529af92200855dcaab10f6bc`.
Pattern scans do not guarantee discovery of every unknown secret. Raw private traces,
temporary comparison modules, scripts, logs, fixtures uploaded during evaluation and
generated build/test data remain excluded from Git. Committed fixtures contain only
synthetic text. No GitHub Actions run was triggered: no staging, commit or push occurred.

## Pending Milestone 6 file inventory

These are all pending Milestone 6 files, including work predating this follow-up:

- `README.md`
- `backend/app/api/chat.py`
- `backend/app/main.py`
- `backend/app/schemas/chat.py`
- `backend/app/services/citations.py`
- `backend/app/services/evidence_focus.py`
- `backend/app/services/llm.py`
- `backend/app/services/rag.py`
- `backend/app/services/rag_context.py`
- `backend/pyproject.toml`
- `backend/tests/fixtures/citation-evaluation.json`
- `backend/tests/fixtures/citation-reliability.json`
- `backend/tests/fixtures/citation-validation-cases.json`
- `backend/tests/test_citation_evaluation_postgres.py`
- `backend/tests/test_citation_reliability.py`
- `backend/tests/test_citations.py`
- `backend/tests/test_llm.py`
- `backend/tests/test_rag.py`
- `backend/tests/test_rag_postgres.py`
- `docs/architecture/source-citations.md`
- `docs/citation-reliability-investigation.md`
- `docs/screenshots/citation-source-page.png`
- `docs/screenshots/citation-withheld.png`
- `docs/screenshots/claim-citations.png`
- `docs/verification-milestone-6.md`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/src/components/AppShell.tsx`
- `frontend/src/features/chat/ClaimAnswer.tsx`
- `frontend/src/features/chat/ClaimAnswer.test.tsx`
- `frontend/src/pages/ChatPage.tsx`
- `frontend/src/pages/ChatPage.test.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/types/chat.ts`

The follow-up specifically changes the citation/LLM/context/RAG/schema services, adds
`evidence_focus.py`, two synthetic fixtures and `test_citation_reliability.py`, adjusts
LLM and frontend status tests, clarifies the chat introduction, and updates documentation.
The original Milestone 5 history and context-budget report remain intact. Milestone 7
was not started. Remaining quote errors and incomplete answers should remain visible
during manual review; they have not been declared resolved.
