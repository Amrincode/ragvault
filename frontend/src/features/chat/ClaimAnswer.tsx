import type {
  ChatResponse,
  ChatSource,
  CheckedCitation,
} from '../../types/chat'
import { Badge } from '../../components/ui/Badge'

const reasons = {
  uncited: 'Missing citation',
  invalid_citation: 'Invalid source reference or quote',
  support_not_established: 'Claim wording or number not matched to its quote',
  relevance_not_established: 'Requested category or page limit not matched',
  potential_conflict: 'Possible numeric conflict in the supplied evidence',
  potentially_supported: 'Source wording matched',
}

export function ClaimAnswer({
  result,
  onOpenSource,
  allowSources = true,
  compact = false,
}: {
  result: ChatResponse
  onOpenSource: (source: ChatSource) => void
  allowSources?: boolean
  compact?: boolean
}) {
  const accepted =
    result.claims?.filter(
      (claim) => claim.status === 'potentially_supported',
    ) ?? []
  const withheld =
    result.claims?.filter(
      (claim) => claim.status !== 'potentially_supported',
    ) ?? []
  // Collapse only identical source/quote/check metadata. Each claim keeps its
  // original citation numbers and callback; nothing is renumbered or reassigned.
  const sources = new Map<
    string,
    { citation: CheckedCitation; numbers: Set<number> }
  >()
  accepted.forEach((claim) =>
    claim.citations.forEach((citation) => {
      const key = JSON.stringify([
        citation.source_id,
        citation.document_id,
        citation.collection_id,
        citation.chunk_id,
        citation.filename,
        citation.page_number,
        citation.excerpt,
        citation.match_method,
      ])
      const source = sources.get(key)
      if (source) source.numbers.add(citation.number)
      else sources.set(key, { citation, numbers: new Set([citation.number]) })
    }),
  )
  return (
    <div className="space-y-4">
      {result.status === 'partial' && (
        <p
          role="status"
          className="rounded-control border border-warning-border bg-warning-soft p-3 text-sm text-warning"
        >
          Partial answer: some information is missing or claims were withheld.
          Review the sources.
        </p>
      )}
      {result.status === 'unreliable' && (
        <Badge tone="warning">Answer withheld</Badge>
      )}
      {result.status === 'insufficient_evidence' && (
        <Badge tone="warning">Insufficient evidence</Badge>
      )}
      {!accepted.length && (
        <p className="whitespace-pre-wrap break-words text-body leading-7">
          {result.answer}
        </p>
      )}
      {accepted.length > 0 && (
        <ol aria-label="Answer claims" className="space-y-3">
          {accepted.map((claim, index) => (
            <li key={index}>
              <p className="whitespace-pre-wrap break-words text-body leading-7">
                {claim.text}{' '}
                {claim.citations.map((citation, citationIndex) => (
                  <button
                    key={citationIndex}
                    type="button"
                    disabled={!allowSources}
                    className="mx-0.5 inline-flex min-h-8 min-w-8 items-center justify-center rounded-control border border-line bg-accent-soft px-1.5 align-baseline text-xs font-semibold text-accent disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-ink"
                    aria-label={`Open citation ${citation.number}: ${citation.filename}, page ${citation.page_number}`}
                    onClick={() => onOpenSource(citation)}
                  >
                    [{citation.number}]
                  </button>
                ))}
              </p>
            </li>
          ))}
        </ol>
      )}
      {!!sources.size && (
        <details className="rounded-control border border-line bg-canvas/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Sources · {sources.size}{' '}
            {sources.size === 1 ? 'excerpt' : 'excerpts'}
          </summary>
          <div className="space-y-3 border-t border-line p-4">
            <p className="text-meta text-muted">
              Source wording matched · factual support not independently
              established. Open an original page to review its context.
            </p>
            {[...sources.entries()].map(([key, { citation, numbers }]) => (
              <article
                key={key}
                aria-label={`Source ${[...numbers].join(', ')}`}
                className="min-w-0 rounded-control border border-line bg-surface p-4"
              >
                <p className="break-words text-sm font-medium">
                  {[...numbers].map((number) => `[${number}]`).join(' ')} ·{' '}
                  {citation.filename} · Page {citation.page_number}
                </p>
                <blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-control-border pl-3 text-sm leading-6">
                  {citation.excerpt}
                </blockquote>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-meta text-muted">
                    {citation.match_method === 'exact'
                      ? 'Exact quote match'
                      : 'Whitespace-normalized match; original excerpt shown'}
                  </span>
                  <button
                    type="button"
                    disabled={!allowSources}
                    className="secondary-button text-xs"
                    onClick={() => onOpenSource(citation)}
                    aria-label={`Open original · Page ${citation.page_number}: source ${[...numbers].join(', ')}, ${citation.filename}`}
                  >
                    Open original · Page {citation.page_number}
                  </button>
                </div>
              </article>
            ))}
            {!allowSources && (
              <p className="text-meta text-warning">
                Historical excerpts remain readable; original-page navigation is
                unavailable for this saved answer.
              </p>
            )}
          </div>
        </details>
      )}
      {!!result.evidence_fallback?.length && (
        <details className="rounded-control border border-warning-border p-4 text-sm">
          <summary className="cursor-pointer font-medium text-warning">
            Retrieved source excerpts · not an answer
          </summary>
          <p className="mt-2 text-meta text-muted">
            Evidence was retrieved, but no generated answer passed. These
            original excerpts may be incomplete or irrelevant; they are not
            verified facts or accepted answer claims.
          </p>
          {result.evidence_fallback.map((source) => (
            <div key={source.source_id} className="mt-4 min-w-0">
              <button
                type="button"
                disabled={!allowSources}
                className="min-h-9 break-words text-left text-sm font-medium text-accent underline disabled:text-disabled-ink"
                onClick={() => onOpenSource(source)}
              >
                {source.filename} · Page {source.page_number}
              </button>
              <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-control-border pl-3 text-sm leading-6">
                {source.excerpt}
              </blockquote>
            </div>
          ))}
        </details>
      )}
      {withheld.length > 0 && (
        <details className="rounded-control border border-warning-border bg-warning-soft p-4">
          <summary className="cursor-pointer text-sm font-medium text-warning">
            {withheld.length} generated{' '}
            {withheld.length === 1 ? 'claim withheld' : 'claims withheld'}
          </summary>
          <p className="mt-2 text-meta text-warning">
            These model statements are excluded from the answer. They are not
            established facts.
          </p>
          <ul className="mt-3 space-y-4">
            {withheld.map((claim, index) => (
              <li key={index}>
                <p className="text-meta font-semibold text-warning">
                  {reasons[claim.status]}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {claim.text}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.verification && (
        <details className="text-meta text-muted" open={!compact || undefined}>
          <summary className="min-h-8 cursor-pointer py-1">
            Citation checks and limitations
          </summary>
          <p className="mt-1">
            {result.verification.status === 'source_checks_passed'
              ? 'Source integrity and wording checks passed. '
              : ''}
            {result.verification.notice}
          </p>
          <p className="mt-1">
            Accepted: {result.verification.accepted_claims}; withheld:{' '}
            {result.verification.withheld_claims}. Checks:{' '}
            {result.verification.status}.
          </p>
        </details>
      )}
    </div>
  )
}
