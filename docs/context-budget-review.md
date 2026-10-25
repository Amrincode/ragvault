# Milestone 5 follow-up: context budget and answer quality

Review date: 2026-10-25 (Asia/Singapore).

This is the detailed investigation snapshot before Milestone 5 finalization. Statements
below about staging/history describe that review. Finalization subsequently received
explicit approval to publish the implementation and this report while retaining the
unchanged pipeline, limits and safeguards. See [Milestone 5 verification](verification-milestone-5.md)
for release checks and [GitHub Actions](https://github.com/Amrincode/ragvault/actions/workflows/ci.yml)
for checks on published commits.

**No application code or configuration was changed.** The compact-payload candidate
was tested only in ignored local diagnostic scripts and was not applied. All original
limits, prompts, filters, grounding rules, injection boundaries and source metadata remain.
Nothing was staged, committed or pushed. Milestone 6 was not started.

## Why two passages fit

The active settings are 4,096 context tokens, 512 response tokens, 6,000 serialized user
payload characters, 1,600 characters per passage, and minimum similarity 0.5.
`assemble_context` and `LLMClient.generate` independently enforce:

```text
maximum system + user content = 4096 - 512 - 128 = 3456 UTF-8 bytes
```

This is a deliberately conservative one-byte-per-token packing estimate, not a model
tokenizer. The system message consumes **851 bytes**, leaving **2,605 bytes** for the
question, JSON structure, source metadata and excerpts. The 6,000-character cap is not
the binding limit in these cases. Source chunks are around 1,100–1,200 characters,
below the per-passage cap. Increasing only the character cap would not resolve this.

The assembler proceeds in semantic rank order. It takes the first eligible passage
in full, prefix-truncates the second to consume the remaining budget, and skips later
passages when their metadata plus a usable excerpt will not fit. There is **no hard
two-passage limit**. Top-K controls retrieval candidates, not promised context count.
Other tested questions included three passages with the existing selector.

| Exact user case | Retrieved | Included pages | Excerpt characters included | Complete prompt bytes |
| --- | ---: | --- | ---: | ---: |
| Broad project requirements | 5 | 5, 3 | 1,176 + 704 = 1,880 | 3,456 |
| Project report contents | 10 | 5, 8 | 1,176 + 695 = 1,871 | 3,456 |

All retrieved passages in both original cases passed the 0.5 threshold. There were no
exact duplicate passages causing these omissions. The broad-query scores ranged from
0.6770 to 0.7678; the report-query scores from 0.6071 to 0.7534. These are relevance
heuristics, not confidence or proof of support.

The baseline user payload spent **661/672 bytes** on its non-excerpt content, including
the question, fields and delimiters. Several UUID fields repeat identifiers the model
does not need to interpret evidence. They remain necessary in application-owned API
source records, but need not all appear in the model prompt.

## Retrieval, selection and abstention are different problems

The broad question ranked general focus/guidelines on page 5 first and introduction
on page 3 second. Relevant regulations on page 10 ranked third and were excluded by
the context budget. The report question ranked report instructions on page 8 second,
so useful report content reached Gemma under the same two-passage constraint. Additional
report instructions on page 7 ranked third and were excluded.

The earlier broad-query insufficient-evidence result was reproduced **twice** with the
unchanged prompt and frozen real retrieval results. The report query answered **twice**.
Gemma actually returned some partial information with `insufficient_evidence`; the
application intentionally replaced that text with the fixed insufficient-evidence
message. This was not a transport error, empty retrieval or missing model.

Context selection plausibly contributes to the broad-query failure, but it is not a
complete causal explanation. A controlled diagnostic put already-retrieved regulations
and guidelines first, without increasing the budget or changing production ranking.
Both broad-query trials still returned insufficient evidence. The question spans several
sections, and the model's completeness judgment also matters. Some core sections were
not in its original top-five candidates at all; packing cannot recover unretrieved text.

## Smallest candidate tested: compact model metadata

The experiment sent only source ID, filename, page number and excerpt in compact JSON.
Full API metadata, stable IDs, filters, threshold, system instructions, byte/character
limits, response cap and concurrency were retained. No prompt instructions were relaxed,
and no model output was promoted from insufficient evidence to answered by the test code.

| Metric | Broad case: before → candidate | Report case: before → candidate |
| --- | --- | --- |
| Included passages | 2 → 2 | 2 → 2 |
| Evidence characters | 1,880 → 2,220 | 1,871 → 2,205 |
| Non-excerpt user bytes | 661 → 315 | 672 → 326 |
| Actual Ollama input tokens | 1,047 → 861 | 1,047 → 862 |
| Prompt bytes | 3,456 → 3,456 | 3,456 → 3,456 |
| Model status, two trials | insufficient ×2 → answered ×2 | answered ×2 → answered ×2 |

This recovers about **18% more evidence** in these examples. However, **both compact
broad-query answers misstated a category-specific team size** despite correct evidence.
Their answered status is not a quality pass. Report answers contained more supported
detail, but still did not constitute a complete summary of both categories.

In another targeted report-limit probe, compaction allowed a third passage and correctly
covered both category limits, whereas the baseline abstained because one limit was
missing from the supplied context. This establishes a useful packing benefit, but not
general safety or a universally better answer. The candidate was not applied.

## Actual quality and safeguard tests

Eight real filtered pgvector retrieval queries were evaluated: the two original
questions and six focused/missing-information probes. Frozen hit lists were reused
within each before/after comparison so generation results were not confounded by a
different retrieval result. There were **28 case evaluations and 26 real Gemma calls**;
two unrelated-question cases skipped generation because no passage met the threshold.

| Probe | Baseline | Compact experiment |
| --- | --- | --- |
| Original broad requirements, two trials | Insufficient ×2 | Answered ×2, factual team-size error ×2 |
| Original report contents, two trials | Answered ×2, partial coverage | Answered ×2, more supported detail but incomplete category coverage |
| Focused team sizes | Correct category-specific sizes | Correct category-specific sizes |
| Prototype differences | Core distinction correct; extra incorrect report-limit claim | Same mixed quality result |
| Both report page limits | Insufficient; only one limit available | Correct; third source included |
| Unknown future ceremony date | Insufficient | Insufficient |
| Unspecified mandatory encryption algorithm | Insufficient | Insufficient |
| Unrelated general-knowledge question | Insufficient, no generation | Insufficient, no generation |
| Two synthetic injection passages | Both resisted in tested scenarios | Both resisted in tested scenarios |

Manually reordered report sources were also tested twice. The model still generalized
one category's limit to both, despite relevant evidence being supplied. This is an LLM
accuracy limitation independent of source count. The reordered lists were diagnostic
only; no production reranker was added. Injection probes used in-memory synthetic
retrieval records, not newly uploaded user documents. These results do not prove immunity.

The existing focused automated suites were rerun:

```text
tests/test_rag.py + tests/test_llm.py + tests/test_search.py
67 passed, 1 existing Starlette deprecation warning (52.83 seconds)
Ruff: passed
Ruff format: passed, 59 Python files
```

The frontend, database schema and application implementation were unchanged, so no
frontend build, Docker rebuild or new GitHub Actions run was needed for this diagnostic
review. Earlier Milestone 5 verification remains a separate report, not a new test run.

## Performance and hardware suitability

All trials used the installed Gemma 3 4B with `num_ctx=4096` and `num_predict=512`.
Ollama reported about **1,047 actual input tokens** for both baseline original questions,
well below the configured window. The byte heuristic, rather than Gemma's token window,
is what constrains these two contexts.

| Repeated original question | Baseline generation ms (first / repeat) | Compact generation ms (first / repeat) |
| --- | ---: | ---: |
| Broad requirements | 10,577.56 / 2,113.74 | 11,157.88 / 2,922.38 |
| Report contents | 2,522.61 / 2,155.02 | 3,175.37 / 2,930.14 |

First broad-query calls included model loading. Compact answers were longer (roughly
140–152 output tokens versus 100–107 for baseline examples), so lower input token counts
did not yield faster end-to-end generation. Cold starts, prompt caching, content,
output length and concurrent local activity confound comparisons. This small test does
not establish a performance regression or SLA. Original retrieval times measured in
this review were 3,656 ms cold / 219 ms for the second query; later retrieval probes
ranged from 94 to 3,781 ms.

The laptop GPU reports **6,141 MiB total VRAM**. During the trials, Ollama reported
Gemma at 4,096 context, 100% GPU, about 2.68 GiB model VRAM, plus about 0.31 GiB for
the embedding model. These are residency snapshots, not peak whole-system measurements.
With the 16 GB RAM class laptop, retaining 4K context and single-generation concurrency
is a reasonable conservative operating point. It does not imply that two short passages
are all the model can support. Ollama documents [4K defaults for smaller-VRAM systems
and increased memory requirements for larger contexts](https://docs.ollama.com/context-length).
The [model's advertised maximum context](https://ollama.com/library/gemma3:4b) is not a
recommendation to allocate that maximum on this laptop.

## Recommendation and preservation

1. **Keep all current limits unchanged.** Do not force ten passages into the prompt,
   lower the relevance threshold or suppress insufficient-evidence responses. The
   character limit alone is not the bottleneck.
2. Compacting model-only metadata is the smallest code candidate worth further
   validation; it preserves returned API metadata and recovers evidence without
   increasing resource caps. This trial's mixed factual quality does **not** justify
   applying it as a validated answer-quality fix.
3. For current use, ask for a specific section/category and inspect the source pages.
   A focused team-size question worked correctly, but focused wording is not a guarantee:
   prototype and report probes still exposed model mistakes. Requesting an exhaustive
   whole-project answer from a few truncated passages remains unreliable.
4. Before adopting a selection change, require repeatable category/numeric-fact
   evaluations as well as answer-status, empty-evidence, filter, budget and injection
   tests. A token-aware packer or broader allocation policy would be a separate,
   explicitly evaluated change; neither was introduced here.

All diagnostic scripts, frozen real-document passages, raw answers and private results
remain under ignored `.artifacts`. This report contains no PDF excerpts or local private
paths. No upload, deletion, indexing, reprocessing or database write was needed. The
final preservation guard compared all original records, uploaded files, `.env`, cluster
identity, schema revision and the existing Docker volume. Git history and staging remain
unchanged. See [the original Milestone 5 verification](verification-milestone-5.md) and
[the unchanged chat design](architecture/document-chat.md).
