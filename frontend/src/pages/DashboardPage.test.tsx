import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import * as api from '../lib/api'
import { DashboardPage } from './DashboardPage'
import type { Document, DocumentPage } from '../types/library'

vi.mock('../lib/api', () => ({
  listDocuments: vi.fn(),
  listCollections: vi.fn(),
  listConversations: vi.fn(),
  getHealth: vi.fn(),
}))
const doc: Document = {
  id: 'synthetic-doc',
  collection_id: 'synthetic-group',
  filename: 'Garden research.pdf',
  file_size: 2048,
  mime_type: 'application/pdf',
  checksum: 'a'.repeat(64),
  processing_status: 'processed',
  indexing_status: 'indexed',
  created_at: '2026-10-25T12:00:00Z',
  updated_at: '2026-10-25T12:00:00Z',
}
function mount() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}
function metric(name: string) {
  return within(screen.getByRole('group', { name }))
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listDocuments).mockResolvedValue({
    items: [doc],
    total: 347,
    limit: 20,
    offset: 0,
  })
  vi.mocked(api.listCollections).mockResolvedValue([
    {
      id: doc.collection_id,
      name: 'Research',
      document_count: 347,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    },
  ])
  vi.mocked(api.listConversations).mockResolvedValue({
    items: [],
    total: 78,
    limit: 20,
    offset: 0,
  })
  vi.mocked(api.getHealth).mockResolvedValue({
    status: 'ok',
    application: 'ok',
    database: { status: 'connected' },
    ollama: { status: 'connected' },
  })
})
describe('real workspace dashboard', () => {
  it('uses API totals instead of first-page lengths; makes three bounded workspace requests', async () => {
    mount()
    expect(
      await metric('Total documents').findByText('347'),
    ).toBeInTheDocument()
    expect(await metric('Collections').findByText('1')).toBeInTheDocument()
    expect(
      await metric('Saved conversations').findByText('78'),
    ).toBeInTheDocument()
    expect(screen.getByText(doc.filename)).toBeInTheDocument()
    expect(screen.getByText('Indexed')).toBeInTheDocument()
    expect(screen.getByText(/Research · 2 KB/)).toBeInTheDocument()
    expect(
      screen.queryByRole('group', { name: 'Indexed documents' }),
    ).not.toBeInTheDocument()
    expect(api.listDocuments).toHaveBeenCalledExactlyOnceWith(
      null,
      0,
      expect.any(AbortSignal),
    )
    expect(api.listCollections).toHaveBeenCalledTimes(1)
    expect(api.listConversations).toHaveBeenCalledExactlyOnceWith(
      0,
      expect.any(AbortSignal),
    )
  })
  it('keeps navigation and working quick actions available while loading', () => {
    vi.mocked(api.listDocuments).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.listCollections).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.listConversations).mockReturnValue(new Promise(() => {}))
    mount()
    expect(screen.getByText('Loading recent documents…')).toBeInTheDocument()
    const actions = within(
      screen.getByRole('region', { name: 'Quick actions' }),
    )
    expect(
      actions.getByRole('link', { name: /Upload documents/ }),
    ).toHaveAttribute('href', '/documents')
    expect(
      actions.getByRole('link', { name: /Browse documents/ }),
    ).toHaveAttribute('href', '/documents')
    expect(
      actions.getByRole('link', { name: /Semantic search/ }),
    ).toHaveAttribute('href', '/search')
    expect(
      actions.getByRole('link', { name: /Document chat/ }),
    ).toHaveAttribute('href', '/chat')
  })
  it('displays real zero totals and a useful empty state', async () => {
    vi.mocked(api.listDocuments).mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    })
    vi.mocked(api.listCollections).mockResolvedValue([])
    vi.mocked(api.listConversations).mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    })
    mount()
    expect(
      await screen.findByRole('heading', { name: 'Your library starts here' }),
    ).toBeInTheDocument()
    for (const name of [
      'Total documents',
      'Collections',
      'Saved conversations',
    ])
      expect(metric(name).getByText('0')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Add your first document' }),
    ).toHaveAttribute('href', '/documents')
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
  })
  it('isolates partial API failures and never substitutes an error with zero', async () => {
    vi.mocked(api.listCollections).mockRejectedValue(
      new Error('private server details'),
    )
    mount()
    expect(
      await metric('Collections').findByText('Unavailable'),
    ).toBeInTheDocument()
    expect(
      await metric('Total documents').findByText('347'),
    ).toBeInTheDocument()
    expect(metric('Saved conversations').getByText('78')).toBeInTheDocument()
    expect(screen.getByText(doc.filename)).toBeInTheDocument()
    expect(screen.queryByText('private server details')).not.toBeInTheDocument()
    expect(metric('Collections').queryByText('0')).not.toBeInTheDocument()
    vi.mocked(api.listCollections).mockResolvedValue([])
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry workspace data' }),
    )
    expect(await metric('Collections').findByText('0')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retry workspace data' }),
    ).not.toBeInTheDocument()
  })
  it('shows an unavailable library independently of healthy services', async () => {
    vi.mocked(api.listDocuments).mockRejectedValue(new Error('failure'))
    mount()
    expect(
      await metric('Total documents').findByText('Unavailable'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Recent documents are unavailable/),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('All services connected'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Your library starts here'),
    ).not.toBeInTheDocument()
  })
  it('supports a fully unreachable backend without inventing dependency health', async () => {
    vi.mocked(api.listDocuments).mockRejectedValue(new Error('offline'))
    vi.mocked(api.listCollections).mockRejectedValue(new Error('offline'))
    vi.mocked(api.listConversations).mockRejectedValue(new Error('offline'))
    vi.mocked(api.getHealth).mockRejectedValue(new Error('offline'))
    mount()
    expect(
      await screen.findByText('Backend health could not be checked'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Not checked')).toHaveLength(2)
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Your library starts here'),
    ).not.toBeInTheDocument()
  })
  it('distinguishes a reachable API from unavailable dependencies', async () => {
    vi.mocked(api.getHealth).mockResolvedValue({
      status: 'degraded',
      application: 'ok',
      database: { status: 'unavailable' },
      ollama: { status: 'unavailable' },
    })
    mount()
    expect(
      await screen.findByText('Some services need attention'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Connected')).toHaveLength(1)
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.queryByText('All services connected')).not.toBeInTheDocument()
  })
  it('renders at most five recent uploads with long filenames and per-document states', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      ...doc,
      id: `doc-${i}`,
      filename: `${'Long-name-'.repeat(30)}${i}.pdf`,
      indexing_status: i === 0 ? ('failed' as const) : ('indexed' as const),
    }))
    vi.mocked(api.listDocuments).mockResolvedValue({
      items,
      total: 2000,
      limit: 20,
      offset: 0,
    })
    mount()
    expect(await screen.findByText(items[0].filename)).toHaveClass(
      '[overflow-wrap:anywhere]',
    )
    const recent = within(
      screen.getByRole('region', { name: 'Recent documents' }),
    )
    expect(recent.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByText(items[5].filename)).not.toBeInTheDocument()
    expect(recent.getByText('Indexing failed')).toBeInTheDocument()
    expect(metric('Total documents').getByText('2,000')).toBeInTheDocument()
  })
  it('aborts requests on unmount and ignores their late completion', async () => {
    let resolve!: (value: DocumentPage) => void
    vi.mocked(api.listDocuments).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const view = mount()
    await waitFor(() => expect(api.listDocuments).toHaveBeenCalled())
    const signal = vi.mocked(api.listDocuments).mock.calls[0][2]!
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () =>
      resolve({ items: [doc], total: 1, limit: 20, offset: 0 }),
    )
    expect(screen.queryByText(doc.filename)).not.toBeInTheDocument()
  })
})
