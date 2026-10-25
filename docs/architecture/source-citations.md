# Milestone 6: source citations and answer reliability

This is a single-user, local-only system. No persistent conversations, new database
tables, migrations, authentication, reranking model or major redesign were added.
Existing uploads, chunks, vectors and the PostgreSQL volume remain in place.

## Three different guarantees

| Concept | What it establishes | What it does not establish |
| --- | --- | --- |
| Retrieved source | A compatible indexed passage ranked for the selected document/collection | Relevance to every requested fact |
| Structurally checked citation | A supplied source alias resolves to the same stored document, filename, collection, page and chunk, with a matching excerpt | Truth of a statement using that citation |
| Factually supported claim | Requires considering meaning, negation, categories, context, qualifications and potentially contradictory evidence | This implementation does not independently establish this level |

The API always reports `verification.factual_support="not_established"`. It never
labels an answer fully verified. `potentially_supported` means the source checks and
conservative wording checks passed, not that semantic entailment has been proved.

## Request pipeline

```mermaid
flowchart LR
    Query[Validated question and UUID filters] --> Search[Existing pgvector search]
    Search --> Focus[Bounded report or category/page priority]
    Focus --> Pack[Existing greedy byte packing]
    Pack --> Before[Check source records in PostgreSQL]
    Before --> Model[One non-streaming Gemma chat call]
    Model --> Shape[Strict quote selection schema]
    Shape --> After[Recheck records after generation]
    After --> Quotes[Allowlist IDs and match quoted excerpts]
    Quotes --> Wording[Match claim wording and flag numeric conflicts]
    Wording --> Reply[Accepted claims plus withheld-claim diagnostics]
    Reply --> UI[Numbered references and safe original-page preview]
```

No second LLM judges the answer. Retrieval, generation, deterministic source checks and
heuristic conflict detection are separate testable components. Read transactions are
rolled back before generation; the database connection is not held while Gemma runs.
Source checking performs a bounded read before and after generation, with no writes.
If a source disappeared, changed metadata/text, moved scope or lost compatible indexing,
the request returns **409 `evidence_changed`** and no stale generated answer. This is a
snapshot check, not a lock: a later edit can still invalidate a source after the response.

## Identifiers and model output

Canonical `source_id="S-<chunk UUID>"` is retained from Milestone 5. Each supplied context
source also receives a short, application-generated alias `C1`, `C2`, etc. Numbering is
response-scoped and follows selected context order. Do not reuse a `C1` from another
response. The canonical ID stays stable until reprocessing replaces its chunk.

The model proposes only this internal format:

```json
{
  "status": "answered",
  "claims": [{
    "citations": [{
      "citation_id": "C1",
      "quote": "Starter teams: 2 to 3 members."
    }]
  }]
}
```

Only `answered`, `partial` and `insufficient_evidence` are accepted model statuses.
There are at most six selections, three references per selection
and 400 characters per quote; the prompt prefers at most three short claims to fit the
unchanged 512-token response cap. Strict schemas reject extra model-supplied document,
page or chunk metadata. The model cannot supply citation URLs. Invalid JSON, tool calls,
incomplete generation and malformed structures keep the existing safe 502/503/504 errors.

Following the real-world investigation, the model selects quotations **without a separate
claim-text field**. The application derives each internal claim from its first selected
quote, then validates every reference and corroborating quote. This is an explicit
extractive contract, not a fallback that silently repairs a failed paraphrase. Extra
model-generated `text` fields are rejected, not ignored. The primary guarantee is source
binding and faithful extraction, not a semantic judgment about generated prose. Public
`answer`, `sources`, model metadata and retrieval/timing fields remain available.
`answer` is assembled by the application from accepted claims and numbered references;
there is no uncited free-text channel that bypasses claim checks.

## Deterministic source and quotation checks

`CitationVerifier` reloads only chunk IDs from the application-selected context, joining
documents and embeddings. It checks document ID/name, collection, page, chunk, canonical
ID, alias, processing/indexing state, model name/dimensions and compatible fingerprint
relationships. A context excerpt must occur verbatim in the stored chunk. Explicit
document/collection restrictions are rechecked. Model aliases never drive database
lookups: an unknown `C99` is rejected even if some other database document exists.

Every proposed reference must resolve to a source actually sent to the model. Its quote
must occur in that supplied excerpt, not merely somewhere in the full document or an
unsupplied chunk tail. Exact raw matches are preferred. Whitespace-only differences are
allowed and explicitly reported as `whitespace_normalized`; the returned citation
excerpt is the original matched source substring. Case/spelling/number changes are not
silently corrected. `match_method="exact"` denotes a raw quote match.

The independent internal verifier marks missing references `uncited`; the model-facing
selection schema requires at least one reference and rejects malformed empty selections.
Unknown IDs, empty/unmatched quotes or repeated
identical references produce `invalid_citation`. If any reference on a claim is invalid,
the entire claim is withheld; it is not silently repaired by dropping a bad reference.
No model-provided filename, page or document identifier becomes a trusted citation.

## Conservative wording policy and conflicts

A claim is displayable only when its complete wording occurs in **each** supporting
quote, ignoring case and whitespace, with word boundaries. One final display period is
tolerated; no interior punctuation, words, negation or numbers are removed. Numbers cannot match inside
larger numbers. Paraphrases, arithmetic and multi-hop inference are not accepted just
because they share words or cosine similarity. A wrong-category numeric claim is
withheld even if all its numbers happen to appear elsewhere in the same source.

Multiple references can corroborate the same short claim when each quote contains its
wording. Complementary evidence should be split into separate supported claims rather
than combined into a new, unverified inference. This favors extractive reliability over
fluency and can reject correct paraphrases. It does not infer whether the source itself
is true or whether a matching fragment omits an outside qualifier. A source can be
misleading or wrong. In extractive generation the wording is selected quotation text;
correct paraphrases remain unsupported by the independent verifier rather than being
accepted through fuzzy matching or another model's opinion.

Two small English scope heuristics address observed irrelevant-but-source-valid claims:
a single explicit requested category must be present in the claim, with no conflicting
supplied category label; an explicit page-limit question must receive page wording,
rather than presentation minutes. Such failures become `relevance_not_established`.
Comparison/compound questions and general semantic relevance are not covered. Numeric
fragments must also retain category labels from the same source sentence preceding the
quote (`numeric_category_omitted`), limiting the observed unqualified 40-page assertion.
These are conservative heuristics, not a parser or factual-verification system.

The numeric-conflict heuristic looks for the same surrounding wording with different
numeric tokens across supplied passages. It can flag `Starter teams: 2 to 3 members`
versus `Starter teams: 2 to 5 members`, even if only one is cited. Such claims become
`potential_conflict` and are withheld. This is **not** a proof of contradiction. Bare
numeric fragments can overflag different categories, equivalent number spellings can
overflag, and differently worded, qualified or multilingual contradictions can be missed.
It does not resolve source authority, dates, units or policy versions, and cannot inspect
contrary passages excluded from context.

| Claim status | Interpretation / action |
| --- | --- |
| `potentially_supported` | Source integrity and full wording checks passed; display with references |
| `uncited` | Empty reference list; withhold |
| `invalid_citation` | ID or quote cannot be validated; withhold |
| `support_not_established` | Claim wording/numbers not witnessed by its quotes; withhold |
| `relevance_not_established` | Explicit requested category/page-limit heuristic failed; withhold |
| `potential_conflict` | Numeric-template heuristic found different values; withhold |

Reason codes include `missing_citation`, `unknown_citation`, `missing_quote`,
`quote_mismatch`, `duplicate_citation`, `wording_not_matched`,
`numeric_support_not_established`, `numeric_category_omitted`,
`requested_category_not_matched`, `requested_page_limit_not_matched` and
`heuristic_numeric_conflict`.

## Public API and compatibility

`POST /api/chat` request fields are unchanged: `question`, optional UUID filters and
top-K. Responses add `claims`, `verification`, `sources[].citation_id` and
`timings.verification_ms`. Each checked reference contains:

- `citation_id`, application-derived `number`, canonical `source_id`;
- `document_id`, `filename`, `collection_id`, `page_number`, `chunk_id`;
- original matching `excerpt` and explicit `match_method`.

Answer statuses now include:

| Status | Meaning |
| --- | --- |
| `answered` | Model declared answered, with accepted claims and none withheld; not proof of completeness |
| `partial` | Model declared partial, or at least one claim was withheld while some passed |
| `insufficient_evidence` | No usable context or model abstention; fixed application message |
| `unreliable` | Model attempted an answer but no claims passed; fixed withholding message |

Verification reports `not_run`, `source_checks_passed` or `issues_found`, plus accepted
and withheld counts. `not_run` refers to claim analysis when no answer was attempted;
source checks still occur around a generation that subsequently abstains.
`factual_support` always remains `not_established`. Model abstention text is still
discarded; unsupported facts cannot be smuggled through an abstention explanation.

Old clients can continue reading `answer` and `sources`, but should handle the two new
status values. The frontend tolerates legacy responses without claim arrays. Clients
must not display raw withheld claim text as an accepted answer. Diagnostics intentionally
retain that untrusted text for inspection; the application separates it behind an
explicit withheld-claims disclosure and gives it no active citation controls.

## Context, resource limits and security

The top-K defaults, minimum similarity, 4K model context,
512 response tokens, 6,000-character payload cap, 1,600-character passage cap, byte
packing estimate, timeouts and single-generation admission remain unchanged. The
current system prompt is 1,024 UTF-8 bytes (initial M6: 874; M5: 851).
The unsuccessful metadata-compaction experiment remains excluded. No selection policy
was adopted without controlled evidence, and more retrieved passages still need not fit.

Before greedy packing, a stable local priority within the **already retrieved top-K**
promotes report sections containing `report ... should/must include` for report-content
questions, or a requested category's page clause for explicit category/page-limit
questions. Other ordering is preserved. No extra retrieval, source rewriting or larger
budget is used. Controlled replay moved the real brief's report pages ahead of generic
aims, and the Advanced page clause ahead of the Starter clause. This intentionally
limited lexical priority can miss headings phrased differently and is not a reranker.

The LLM sees the question and explicitly delimited untrusted source fields. It has no
tools, filesystem, commands, SQL or application secrets. All data operations and metadata
stay under application control. Citation text is never interpolated as SQL or a file
path; literal regex pieces are escaped and all workloads are bounded. HTTPX ignores
proxy environment settings and follows no chat redirects. Logs contain no prompts,
excerpts, answers or raw provider exceptions. Success responses remain `no-store`.

The interface renders plain React text, no model HTML/Markdown parser or arbitrary
URLs. Numbered buttons open application-provided document UUIDs at checked pages via
the existing PDF.js preview; accessible disclosures show supporting excerpts and match
methods. Retrieved context cards remain separately labelled. Prompt instructions alone
do not guarantee immunity: malicious source content can bias outputs or contain false
facts. Structural verification is an architectural boundary, not a complete semantic
or prompt-injection defense. There is no authentication; keep deployment local.

Checks use the stored chunk and document metadata, without reparsing or checksumming
the entire original PDF on each answer. External modification of stored PDFs outside
the application can therefore invalidate the preview's relationship to those chunks.
Repeated model claims are not deduplicated. Qualifiers outside the selected quotation
and contradictions outside supplied context are not comprehensively checked.

## Reproducible evaluation

`backend/tests/fixtures/citation-evaluation.json` defines nine synthetic known-answer
cases covering direct/broad/partial/missing answers, exact category numbers, multiple
pages, conflicting evidence, embedded instructions and fake citation aliases. CI creates
disposable PDFs and isolated PostgreSQL schemas, mocking embeddings and chat. Other
tests force wrong numeric claims, invented pages/IDs, stale records and unsafe rendering.

Separate live evaluation uses the installed small local models and disposable PDFs.
Correctness/expected-fact coverage and source/quote integrity are scored separately;
no citation-check success is counted as automatic semantic correctness. The initial
nine-case comparison held context selection fixed; the real-world follow-up measured
the focused priority changes separately. Latency includes quote output and two bounded source reads.
See [Milestone 6 verification](../verification-milestone-6.md) for actual results,
browser evidence, performance, false positives and the completion checklist.
The [real-world investigation](../citation-reliability-investigation.md) supersedes the
initial output contract and records both failed candidates and retained improvements.
