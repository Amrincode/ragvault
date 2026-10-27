import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import axe from 'axe-core'
import userEvent from '@testing-library/user-event'
import * as api from '../lib/api'
import { ThemeProvider } from '../theme/ThemeProvider'
import { DashboardPage } from '../pages/DashboardPage'
import { DocumentsPage } from '../pages/DocumentsPage'
import { SearchPage } from '../pages/SearchPage'
import { ChatPage } from '../pages/ChatPage'
import { PreviewDialog, NameDialog } from '../features/documents/LibraryDialogs'
import type { Document } from '../types/library'
import { ClaimAnswer } from '../features/chat/ClaimAnswer'
import { ChatMessage } from '../features/chat/ChatMessage'
import type { ChatResponse, CheckedCitation } from '../types/chat'

vi.mock('../lib/api')
vi.mock('../features/documents/PdfPreview', () => ({
  default: () => <canvas role="img" aria-label="Synthetic PDF, page 1" />,
}))
const doc: Document = {
  id: 'synthetic-doc',
  collection_id: 'synthetic-group',
  filename: 'Garden guide.pdf',
  file_size: 1024,
  mime_type: 'application/pdf',
  checksum: 'a'.repeat(64),
  processing_status: 'processed',
  indexing_status: 'indexed',
  created_at: '2026-10-27T00:00:00Z',
  updated_at: '2026-10-27T00:00:00Z',
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      media,
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  localStorage.clear()
  vi.mocked(api.listCollections).mockResolvedValue([
    {
      id: doc.collection_id,
      name: 'Garden research',
      document_count: 1,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    },
  ])
  const documents = { items: [doc], total: 1, offset: 0, limit: 20 }
  vi.mocked(api.listDocuments).mockResolvedValue(documents)
  vi.mocked(api.listSearchDocuments).mockResolvedValue(documents)
  vi.mocked(api.listConversations).mockResolvedValue({
    items: [],
    total: 0,
    offset: 0,
    limit: 20,
  })
  vi.mocked(api.getLibraryConfig).mockResolvedValue({
    max_upload_bytes: 25_000_000,
    max_pdf_pages: 2000,
  })
  vi.mocked(api.getHealth).mockResolvedValue({
    status: 'ok',
    application: 'ok',
    database: { status: 'connected' },
    ollama: { status: 'connected' },
  })
  vi.mocked(api.getDocumentPDF).mockResolvedValue(new Blob(['synthetic']))
  vi.mocked(api.documentDownloadUrl).mockReturnValue('/synthetic-original')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function audit(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: {
      type: 'tag',
      values: [
        'wcag2a',
        'wcag2aa',
        'wcag21a',
        'wcag21aa',
        'wcag22aa',
        'best-practice',
      ],
    },
    // jsdom has no layout/color engine. Browser audits and token contrast tests cover these.
    rules: { 'color-contrast': { enabled: false } },
  })
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((n) => n.target),
    })),
  ).toEqual([])
}

describe('automated accessibility smoke checks', () => {
  it('keeps search action names consistent with visible original-page labels', async () => {
    vi.mocked(api.searchPassages).mockResolvedValue({
      items: [
        {
          document_id: doc.id,
          collection_id: doc.collection_id,
          filename: doc.filename,
          page_number: 2,
          chunk_id: 'synthetic-chunk',
          excerpt: 'Water seedlings before 9 am.',
          distance: 0.2,
          similarity: 0.8,
        },
      ],
      model: 'synthetic-embeddings',
      dimensions: 3,
      top_k: 5,
      elapsed_ms: 1,
      incompatible_documents: 0,
    })
    const view = render(
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>,
    )
    await screen.findByRole('option', { name: doc.filename })
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search question' }),
      'watering time',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    await screen.findByRole('button', {
      name: 'Open original · Page 2: Garden guide.pdf',
    })
    await audit(view.container)
  })
  it('keeps expanded citation actions accessible without asserting factual truth', async () => {
    const citation: CheckedCitation = {
      source_id: 'S-synthetic',
      citation_id: 'C1',
      number: 1,
      chunk_id: 'synthetic-chunk',
      document_id: doc.id,
      collection_id: doc.collection_id,
      filename: doc.filename,
      page_number: 2,
      excerpt: 'Water seedlings before 9 am.',
      match_method: 'exact',
    }
    const answer: ChatResponse = {
      status: 'answered',
      answer: citation.excerpt,
      sources: [citation],
      chat_model: 'synthetic-chat',
      embedding_model: 'synthetic-embeddings',
      retrieval_count: 1,
      context_count: 1,
      incompatible_documents: 0,
      timings: { retrieval_ms: 1, generation_ms: 1, total_ms: 2 },
      claims: [
        {
          text: citation.excerpt,
          status: 'potentially_supported',
          citations: [citation],
          issues: [],
        },
      ],
    }
    const view = render(
      <main>
        <h1>Document answer</h1>
        <ClaimAnswer result={answer} onOpenSource={vi.fn()} compact />
      </main>,
    )
    await userEvent.click(screen.getByText('Sources · 1 excerpt'))
    await audit(view.container)
  })
  it('exposes complete message dates as semantic text instead of prohibited time labels', async () => {
    const date = '2026-10-27T00:00:00Z'
    const view = render(
      <main>
        <h1>Conversation</h1>
        <ol>
          <ChatMessage
            message={{
              id: 'message',
              role: 'user',
              position: 1,
              request_id: 'request',
              status: 'complete',
              content: 'When should we water seedlings?',
              answer: null,
              citation_state: 'none',
              created_at: date,
              error_code: null,
            }}
            openSource={vi.fn()}
            retry={vi.fn()}
            disabled={false}
          />
        </ol>
      </main>,
    )
    expect(screen.getByText(new Date(date).toLocaleString())).toHaveClass(
      'sr-only',
    )
    expect(view.container.querySelector('time')).toHaveAttribute(
      'datetime',
      date,
    )
    await audit(view.container)
  })
  it.each([
    ['Dashboard', '/', <DashboardPage />],
    ['Document library', '/documents', <DocumentsPage />],
    ['Semantic search', '/search', <SearchPage />],
    ['Document chat', '/chat', <ChatPage />],
    ['Ask a single question', '/chat?mode=single', <ChatPage />],
  ] as const)(
    '%s exposes labeled controls and valid landmarks',
    async (heading, route, page) => {
      const view = render(
        <ThemeProvider>
          <MemoryRouter initialEntries={[route]}>{page}</MemoryRouter>
        </ThemeProvider>,
      )
      await screen.findByRole('heading', { name: heading, level: 1 })
      await waitFor(() =>
        expect(
          screen.queryByText(
            /Loading (?:search filters|conversations|collections|recent documents)…/,
          ),
        ).toBeNull(),
      )
      await audit(view.container)
    },
  )
  it('provides an accessible reader dialog with original download', async () => {
    const view = render(<PreviewDialog document={doc} onClose={vi.fn()} />)
    await screen.findByRole('img', { name: 'Synthetic PDF, page 1' })
    await audit(view.container)
  })
  it('associates the management dialog label and description', async () => {
    const view = render(
      <NameDialog
        title="Rename collection"
        initialValue="Garden research"
        label="Collection name"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await audit(view.container)
  })
})
