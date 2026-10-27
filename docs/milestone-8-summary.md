# Milestone 8 — UI completion summary

The six UI stages are implemented and verified. Stage 8.6 completes the final QA and
publication review for Milestone 8. Milestones 9 and 10 have not started. This summary does not claim production readiness or complete WCAG conformance.

| Stage | Delivered | Evidence |
| --- | --- | --- |
| 8.1 — shared foundation | Semantic colors/typography, shared controls, Light/Dark/System themes, early theme initialization and contrast tests | [Report](verification-milestone-8-1.md), commit `174a5b8` |
| 8.2 — navigation/dashboard | Responsive navigation drawer, keyboard route focus, genuine workspace totals and separate service checks | [Report](verification-milestone-8-2.md), commit `13be06c` |
| 8.3 — document library | Responsive collection/PDF management, explicit processing versus indexing, readable technical metadata and confirmations | [Report](verification-milestone-8-3.md), commit `c405593` |
| 8.4 — conversations/chat | Saved and unsaved workspaces, responsive history, anchored composer, scroll preservation, source disclosures and uncertainty | [Report](verification-milestone-8-4.md), commit `835962f` |
| 8.5 — search/reader | Original passage cards, raw cosine explanation, exact-page navigation, direct page entry, bounded zoom/rendering and cleanup | [Report](verification-milestone-8-5.md), commit `fac0c4d` |
| 8.6 — final QA | Correct heading order and source action names, stronger metadata contrast, semantic timestamps, route titles, failed-form focus recovery, actionable offline errors and automated accessibility checks | [Final QA and publication review](verification-milestone-8-6.md) |

The [design system](design-system.md) remains Modern Professional: a light-first workspace,
navy navigation, restrained teal actions, semantic surfaces and plain readable evidence.
The [README](../README.md) provides a concise feature/gallery overview and the existing
Windows/Docker/Ollama startup instructions. New gallery images contain synthetic garden
data only, served by the real application in an isolated QA schema.

Stage 8.6 ran 287 frontend tests, 319 ordinary backend tests and all 21 opt-in PostgreSQL
integration cases, together with lint/format/type/dependency checks, production build,
schema consistency and Docker build/smoke checks. The final QA report distinguishes
automated results, live workflows, simulated error cases and unperformed device checks.

The AI pipeline, models, retrieval, context limits, citation validator, persistence and
database schema are retained. Stage 8.5's narrowly scoped response-cleanup correction
prevents cancelled PDF downloads from retaining Windows handles; Stage 8.6 regression
checks retain that behavior. Original data, uploads, configuration, volumes and Git
history are preserved.

Known limits remain: local single-user access without authentication, heuristic evidence
selection and follow-ups, incomplete or irrelevant model output, and wording checks that
do not prove truth or completeness. The preview is an image-based bounded PDF reader;
text layers, accurate highlighting, OCR and annotations are deferred. Dedicated
whole-document summarization is not implemented, and model selection is future work.
Actual screen-reader output, physical mobile keyboards, every zoom/device combination
and OS reduced-motion switching remain outside the completed checks.
