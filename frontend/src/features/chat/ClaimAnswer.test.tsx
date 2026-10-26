import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatResponse, CheckedCitation } from '../../types/chat'
import { ClaimAnswer } from './ClaimAnswer'

const citation: CheckedCitation = {
  citation_id: 'C1',
  source_id: 'S-chunk',
  number: 1,
  chunk_id: 'chunk',
  document_id: 'document',
  collection_id: 'collection',
  filename: 'synthetic.pdf',
  page_number: 2,
  excerpt: 'Starter teams: 2 to 3 members.',
  match_method: 'exact',
}
const response: ChatResponse = {
  status: 'answered',
  answer: 'Starter teams: 2 to 3 members. [1]',
  sources: [citation],
  chat_model: 'gemma3:4b',
  embedding_model: 'nomic-embed-text',
  retrieval_count: 1,
  context_count: 1,
  incompatible_documents: 0,
  timings: {
    retrieval_ms: 1,
    generation_ms: 2,
    verification_ms: 1,
    total_ms: 4,
  },
  claims: [
    {
      text: 'Starter teams: 2 to 3 members.',
      status: 'potentially_supported',
      citations: [citation],
      issues: [],
    },
  ],
  verification: {
    status: 'source_checks_passed',
    factual_support: 'not_established',
    accepted_claims: 1,
    withheld_claims: 0,
    notice: 'Source checks do not independently establish factual truth.',
  },
}

describe('Claim citations', () => {
  it('shows numbered references with the correct application-owned page', () => {
    const open = vi.fn()
    render(<ClaimAnswer result={response} onOpenSource={open} />)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open citation 1: synthetic.pdf, page 2',
      }),
    )
    expect(open).toHaveBeenCalledWith(citation)
    expect(
      screen.getByText(
        /Source checks do not independently establish factual truth\./,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/factual support not independently established/),
    ).toBeInTheDocument()
  })
  it('supports keyboard-accessible excerpt disclosure and multiple references', () => {
    const second = { ...citation, citation_id: 'C2', number: 2, page_number: 3 }
    render(
      <ClaimAnswer
        result={{
          ...response,
          claims: [{ ...response.claims![0], citations: [citation, second] }],
        }}
        onOpenSource={vi.fn()}
      />,
    )
    expect(
      screen.getAllByRole('button', { name: /Open citation/ }),
    ).toHaveLength(2)
    const disclosure = screen.getByText('Sources \u00b7 2 excerpts')
    expect(disclosure.tagName).toBe('SUMMARY')
    expect(disclosure.parentElement).not.toHaveAttribute('open')
    fireEvent.click(disclosure)
    expect(screen.getByRole('article', { name: 'Source 1' })).toHaveTextContent(
      'synthetic.pdf',
    )
    expect(screen.getByRole('article', { name: 'Source 2' })).toHaveTextContent(
      'Page 3',
    )
    expect(
      screen.getAllByText('Starter teams: 2 to 3 members.').length,
    ).toBeGreaterThan(1)
  })
  it('explains a partial answer and separates withheld claims', () => {
    render(
      <ClaimAnswer
        result={{
          ...response,
          status: 'partial',
          claims: [
            ...response.claims!,
            {
              text: 'Invented fact',
              status: 'uncited',
              citations: [citation],
              issues: ['missing_citation'],
            },
          ],
        }}
        onOpenSource={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Partial answer')
    expect(screen.getByText('1 generated claim withheld')).toBeInTheDocument()
    expect(screen.getByText('Missing citation')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /Open citation/ }),
    ).toHaveLength(1)
  })
  it.each([
    'invalid_citation',
    'support_not_established',
    'relevance_not_established',
    'potential_conflict',
  ] as const)('shows %s without an active source link', (status) => {
    render(
      <ClaimAnswer
        result={{
          ...response,
          status: 'unreliable',
          answer: 'Claims withheld.',
          claims: [
            {
              text: 'Incorrect 99-member limit',
              status,
              citations: [citation],
              issues: [],
            },
          ],
        }}
        onOpenSource={vi.fn()}
      />,
    )
    expect(screen.getByText('Claims withheld.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open citation/ })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Answer claims' })).toBeNull()
  })
  it('renders model claims, quotes and filenames as inert text', () => {
    const attack = '<img src=x onerror=alert(1)> [run](javascript:alert(2))'
    const evil = { ...citation, filename: attack, excerpt: attack }
    const view = render(
      <ClaimAnswer
        result={{
          ...response,
          claims: [{ ...response.claims![0], text: attack, citations: [evil] }],
        }}
        onOpenSource={vi.fn()}
      />,
    )
    expect(
      view.container.querySelector('img,script,a[href^="javascript:"]'),
    ).toBeNull()
    expect(screen.getAllByText(attack).length).toBeGreaterThan(0)
  })
  it('keeps old plain-text responses readable without asserting verification', () => {
    render(
      <ClaimAnswer
        result={{
          ...response,
          claims: undefined,
          verification: undefined,
          answer: 'Legacy answer',
        }}
        onOpenSource={vi.fn()}
      />,
    )
    expect(screen.getByText('Legacy answer')).toBeInTheDocument()
    expect(screen.queryByText(/checks passed/)).toBeNull()
  })
  it('deduplicates identical source cards without losing any claim references', () => {
    const open = vi.fn()
    render(
      <ClaimAnswer
        result={{
          ...response,
          claims: [
            response.claims![0],
            {
              ...response.claims![0],
              text: 'A second exact claim.',
              citations: [{ ...citation, citation_id: 'C7', number: 7 }],
            },
          ],
        }}
        onOpenSource={open}
      />,
    )
    expect(
      screen.getByRole('button', {
        name: 'Open citation 1: synthetic.pdf, page 2',
      }),
    ).toBeEnabled()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open citation 7: synthetic.pdf, page 2',
      }),
    )
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ number: 7, citation_id: 'C7' }),
    )
    fireEvent.click(screen.getByText('Sources \u00b7 1 excerpt'))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('article')).toHaveTextContent('[1] [7]')
  })
  it('keeps different quotes and match methods separate even on the same source page', () => {
    render(
      <ClaimAnswer
        result={{
          ...response,
          claims: [
            {
              ...response.claims![0],
              citations: [
                citation,
                {
                  ...citation,
                  number: 2,
                  excerpt: 'Different original excerpt.',
                },
                {
                  ...citation,
                  number: 3,
                  match_method: 'whitespace_normalized',
                },
              ],
            },
          ],
        }}
        onOpenSource={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('Sources \u00b7 3 excerpts'))
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(
      screen.getByText('Whitespace-normalized match; original excerpt shown'),
    ).toBeInTheDocument()
  })
  it('keeps historical quotes readable while disabling every original-page control', () => {
    render(
      <ClaimAnswer
        result={response}
        allowSources={false}
        onOpenSource={vi.fn()}
        compact
      />,
    )
    expect(
      screen.getByRole('button', { name: /Open citation 1/ }),
    ).toBeDisabled()
    fireEvent.click(screen.getByText('Sources \u00b7 1 excerpt'))
    expect(screen.getByRole('button', { name: /Open source 1/ })).toBeDisabled()
    expect(screen.getByText('Exact quote match')).toBeInTheDocument()
    expect(
      screen.getByText(/original-page navigation is unavailable/),
    ).toBeInTheDocument()
  })
  it('never presents a fully withheld answer as a successful answer', () => {
    render(
      <ClaimAnswer
        result={{
          ...response,
          status: 'unreliable',
          answer: 'No generated answer passed.',
          claims: [{ ...response.claims![0], status: 'invalid_citation' }],
        }}
        onOpenSource={vi.fn()}
        compact
      />,
    )
    expect(screen.getByText('Answer withheld')).toBeInTheDocument()
    expect(screen.queryByText(/Sources \u00b7/)).toBeNull()
    expect(
      screen.getByText('Citation checks and limitations').parentElement,
    ).not.toHaveAttribute('open')
  })
})
