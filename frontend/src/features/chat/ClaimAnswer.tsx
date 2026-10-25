import type { ChatResponse, ChatSource } from '../../types/chat'

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
}: {
  result: ChatResponse
  onOpenSource: (source: ChatSource) => void
}) {
  const accepted =
    result.claims?.filter(
      (claim) => claim.status === 'potentially_supported',
    ) ?? []
  const withheld =
    result.claims?.filter(
      (claim) => claim.status !== 'potentially_supported',
    ) ?? []
  return (
    <div className="mt-4 space-y-4">
      {result.status === 'partial' && (
        <p
          role="status"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
        >
          Partial answer: some information is missing or claims were withheld.
          Review the sources.
        </p>
      )}
      {result.verification && (
        <p className="text-xs leading-5 text-muted">
          {result.verification.status === 'source_checks_passed'
            ? 'Source integrity and wording checks passed. '
            : ''}
          {result.verification.notice}
        </p>
      )}
      {!accepted.length && (
        <p className="whitespace-pre-wrap break-words text-sm leading-7">
          {result.answer}
        </p>
      )}
      {accepted.length > 0 && (
        <ol aria-label="Answer claims" className="space-y-5">
          {accepted.map((claim, index) => (
            <li key={index} className="border-l-2 border-mint pl-4">
              <p className="whitespace-pre-wrap break-words text-sm leading-7">
                {claim.text}{' '}
                {claim.citations.map((citation, citationIndex) => (
                  <button
                    key={citationIndex}
                    type="button"
                    className="mx-1 rounded px-1 font-semibold text-forest underline focus-visible:outline-2"
                    aria-label={`Open citation ${citation.number}: ${citation.filename}, page ${citation.page_number}`}
                    onClick={() => onOpenSource(citation)}
                  >
                    [{citation.number}]
                  </button>
                ))}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                Source wording matched · factual support not independently
                established
              </p>
              {claim.citations.map((citation, citationIndex) => (
                <details
                  key={citationIndex}
                  className="mt-2 rounded-lg border border-line p-3 text-xs"
                >
                  <summary className="cursor-pointer break-words font-medium">
                    Supporting excerpt [{citation.number}] · {citation.filename}{' '}
                    · Page {citation.page_number}
                  </summary>
                  <blockquote className="mt-3 whitespace-pre-wrap break-words leading-6">
                    {citation.excerpt}
                  </blockquote>
                  <p className="mt-2 text-muted">
                    {citation.match_method === 'exact'
                      ? 'Exact quote match'
                      : 'Whitespace-normalized match; original excerpt shown'}
                  </p>
                </details>
              ))}
            </li>
          ))}
        </ol>
      )}
      {withheld.length > 0 && (
        <details className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-amber-900">
            {withheld.length} generated{' '}
            {withheld.length === 1 ? 'claim withheld' : 'claims withheld'}
          </summary>
          <p className="mt-2 text-xs text-amber-900">
            These model statements are excluded from the answer. They are not
            established facts.
          </p>
          <ul className="mt-3 space-y-4">
            {withheld.map((claim, index) => (
              <li key={index}>
                <p className="text-xs font-semibold text-amber-900">
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
    </div>
  )
}
