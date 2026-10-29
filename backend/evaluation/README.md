# Synthetic AI reliability benchmark (Stage 10.1)

This is opt-in measurement infrastructure, separate from production startup and
ordinary deterministic tests. It does not improve prompts, retrieval, citation rules,
context budgets or model selection. The default run measures all **16 cases twice**.

## Run

From the repository root, with existing backend dependencies, Docker and Ollama:

```powershell
docker compose build backend postgres
Set-Location backend
.\.venv\Scripts\python.exe -m evaluation.run --list
.\.venv\Scripts\python.exe -m evaluation.run --trials 2
# Select cases without changing the corpus or production pipeline:
.\.venv\Scripts\python.exe -m evaluation.run --case advanced-limit --case page-boundary --trials 3
# Deterministic tests; no model requests:
.\.venv\Scripts\python.exe -m pytest tests/test_evaluation.py
```

The host entrypoint needs Python and the existing `python-dotenv` dependency; native
PDF/SQL imports are only needed by the worker inside the current backend image.
No models/packages/images are downloaded automatically (`--pull=never`). Build the
current images first: the worker rejects a stale production application-source hash.
Do not run a benchmark while judging interactive answer latency; it uses the same
local Ollama service and may temporarily load/unload its configured models.

The runner reads current public pipeline settings and model names from `.env`, with
process environment precedence. It never writes `.env`. Localhost Ollama addresses
are translated to `host.docker.internal` inside Docker; an explicit existing
`OLLAMA_DOCKER_BASE_URL` takes precedence for Docker access. Database/upload settings
are never inherited: a unique fresh database/network and ephemeral upload storage
are mandatory. APP_ENV is test for ASGI TestClient, and logging is reduced to WARNING
inside the owned worker. No production route/service decisions are mocked or replaced.

Each invocation creates a new `.artifacts/evaluations/<id>.ragvault-eval/` with local
JSON results, summary, checkpoints, run metadata and a log. All raw output is
Git-ignored, with new POSIX directories/files 0700/0600; Windows parent ACLs apply.
Ignore rules are not encryption or protection against cloud sync. The bundled runner
accepts only this fictional corpus, never an original user PDF or external dataset.
Treat raw reports as private by default; publish only reviewed synthetic examples
and the whitelisted baseline summary. There is no automatic baseline overwrite.

## Isolation and observation

Every live invocation creates labelled PostgreSQL/pgvector storage on tmpfs and an
owned Docker network. The worker has no original data volume/bind mount and no
published port. It mounts only this evaluation directory read-only and its new output
directory. Guards require the exact generated database hostname, test database,
empty six-table inventory and ephemeral upload location. Schema creation/migration
runs only there. Cleanup verifies labels and removes only owned resources; no volume
prune, Compose down, original-data restoration or user service shutdown is performed.
An incomplete/cancelled run is recorded as such, including cleanup status.

The worker exercises actual upload, processing, indexing, chat and saved-conversation
ASGI routes through TestClient. PostgreSQL, PDF parser subprocesses, embeddings and
Gemma calls are real. This measures the backend pipeline, not browser behavior or
HTTP socket overhead to FastAPI. Read-only wrappers copy search hits, model-context
sources, generated quote selections and the complete RAG response before saved-
conversation snapshots discard rejected claims. Wrappers return the original objects
unchanged. Full provider response bodies and system prompt dumps are not recorded.

Each follow-up trial creates a new saved conversation and executes its own preceding
question through the same pipeline. Primer requests/calls are reported separately
from scored target questions. No prior trial's answers enter another trial's history.
The full background corpus is uploaded even when selecting a subset of cases, so
scope/conflict conditions are reproducible. Question top-K comes from current RAG
configuration; the runner does not override it.

## Corpus and ground truth

`corpus.json` is versioned, fictional, original benchmark content dedicated under
[CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/). Generated PDFs contain
only these sentences. No user PDF, private quote or externally sourced PDF is used.
The five documents have nine pages across two collections. A page footer/top-of-next-
page pair and a multi-chunk report checklist probe boundary/context limitations.

Each case contains its question, action, category, scope, required facts, document/
page/quote gold references, acceptable answer criteria, forbidden alternatives and
limitations. The declarative source sentences define this fictional world. Keys are
checked mechanically against the actual generated PDF text and page placement;
explicit tests independently assert the conflicting 20/40/80-page limits. Gemma does
not generate or judge the answer key. This is not independent human/expert validation
of real-world facts. Every generated PDF hash, corpus SHA-256/version, renderer hash,
harness-source hash, production-source hash, model digest and effective pipeline limit
is recorded. Raw fingerprints describe the run's actual bytes; the public export also
includes canonical JSON identity for cross-checkout comparison without CRLF/LF
formatting differences. Same-version rendering is tested for byte determinism; different PyMuPDF
versions/platforms may produce different bytes. New databases use real random UUIDs, so separate
invocations are not guaranteed byte-identical model prompts. Repeated trials within
one invocation keep the corpus's source identities fixed.

## Metrics (all denominators are recorded)

- Retrieval page recall: required unique document/page pairs present in actual hits.
  Evidence recall additionally requires the full gold sentence in a matching hit.
- Context evidence recall: gold evidence that actually survives selection/truncation.
  Operationally unobserved stages are excluded from stage-conditional recall, reported
  separately and never treated as successful answers.
- Answer completeness: required answer spans in displayed accepted claims with valid
  original references, over required facts for answerable attempts. Failures contribute
  no displayed facts. Fallback excerpts are not answers.
- Strict key compliance: required facts covered, no forbidden/scope/marker violation,
  and no unrelated or unassessed accepted claims; expected abstention or explicitly
  qualified alternatives are handled separately. This is a conservative answer-key
  criterion, **not universal semantic/factual accuracy**. Shorter listed answer spans
  allow names/dates; other equivalent wording needs manual review.
- Citation document/page validity checks aliases/metadata against actual stored
  chunks. Quote matching checks original chunk text. Neither proves factual support.
- Key-backed claim support is assessed against the independent synthetic fact map.
  Other known facts (possibly true but irrelevant) and unassessed claims are separate;
  unassessed never means proven false. Literal claim/quote agreement is also measured.
- Appropriate abstention counts completed abstentions on unanswerable cases. Incorrect
  abstention is reported separately for gold evidence retrieved versus actually in
  model context. Operational errors never earn successful abstention credit.
- Scope leakage checks retrieval/context/citation metadata and known out-of-scope fact
  spans in accepted text. Novel paraphrases can escape automatic detection; this is
  not a comprehensive semantic leakage detector.
- Latencies reuse production retrieval/generation/verification/total timings; setup
  upload/process/index wall times are separate. Median/max/sample count are reported,
  with no percentile SLA from this small run.
- Trial variability distinguishes changed outcomes, displayed answer hashes and raw
  selection hashes. Temperature zero does not establish guaranteed repeatability.

Failure labels can overlap. `gold_selection_withheld` is a candidate for review,
not an automatic false-rejection verdict: category/number/relevance safeguards may
correctly reject even source-valid text. Unknown aliases and quote mismatches remain
model-reference failures. Strict key compliance is always accompanied by stage and
failure tables rather than presented as a single misleading accuracy percentage.

Live model evaluation is **not** part of default pytest or GitHub Actions. Deterministic
scorer/isolation tests run normally; the live runner requires explicit invocation.
The actual baseline, examples, environment, tests and preservation evidence are in
[Stage 10.1 verification](../../docs/verification-milestone-10-1.md).


## Frozen Stage 10.1 baseline and publication review

`baseline.json` is the original measured baseline, not a file the runner overwrites.
Publication review added conservative guards against bundling required facts with
irrelevant clauses in one source-valid claim. All 32 original raw observations were
replayed with **identical per-attempt metrics**, and the baseline file bytes, model/
corpus/configuration identities and recorded results were preserved. No additional
model answers were generated for publication. Its historical raw harness fingerprint
identifies the original measurement; the verification report separately identifies
the final scorer and explains checkout line-ending normalization. Future runs must
report their own identities/results rather than replacing this baseline silently.
