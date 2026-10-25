import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { ChatResponse } from '../types/chat'
import type { Document } from '../types/library'
import { ChatPage } from './ChatPage'

vi.mock('../lib/api', () => ({
  listCollections: vi.fn(),
  listSearchDocuments: vi.fn(),
  askDocuments: vi.fn(),
  getDocument: vi.fn(),
}))
vi.mock('../features/documents/LibraryDialogs', () => ({
  PreviewDialog: ({ initialPage }: { initialPage: number }) => (
    <div role="dialog">PDF page {initialPage}</div>
  ),
}))
const document: Document = {
  id: 'doc',
  collection_id: 'group',
  filename: 'retention.pdf',
  file_size: 100,
  mime_type: 'application/pdf',
  checksum: 'a'.repeat(64),
  processing_status: 'processed',
  created_at: '2026-10-25T00:00:00Z',
  updated_at: '2026-10-25T00:00:00Z',
}
const answer: ChatResponse = {
  status: 'answered',
  answer: 'Backups last thirty days.',
  chat_model: 'gemma3:4b',
  embedding_model: 'nomic-embed-text',
  retrieval_count: 1,
  context_count: 1,
  incompatible_documents: 0,
  timings: { retrieval_ms: 12, generation_ms: 100, total_ms: 112 },
  sources: [
    {
      source_id: 'S-chunk',
      chunk_id: 'chunk',
      document_id: 'doc',
      collection_id: 'group',
      filename: 'retention.pdf',
      page_number: 2,
      excerpt: 'Backups are retained for thirty days.',
    },
  ],
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listCollections).mockResolvedValue([
    {
      id: 'group',
      name: 'Policies',
      document_count: 1,
      created_at: document.created_at,
      updated_at: document.updated_at,
    },
  ])
  vi.mocked(api.listSearchDocuments).mockResolvedValue({
    items: [document],
    total: 1,
    offset: 0,
    limit: 100,
  })
  vi.mocked(api.askDocuments).mockResolvedValue(answer)
  vi.mocked(api.getDocument).mockResolvedValue(document)
})
function mount() {
  return render(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>,
  )
}
async function question() {
  await screen.findByRole('option', { name: 'retention.pdf' })
  await userEvent.type(
    screen.getByLabelText('Your question'),
    'How long are backups retained?',
  )
}
async function submit() {
  await userEvent.click(screen.getByRole('button', { name: 'Ask documents' }))
}

describe('Document chat', () => {
  it('preserves scope, answer and source page', async () => {
    mount()
    await question()
    await userEvent.selectOptions(
      screen.getByLabelText('Collection filter'),
      'group',
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Document filter')).not.toBeDisabled(),
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Document filter'),
      'doc',
    )
    await submit()
    expect(
      await screen.findByText('Backups last thirty days.'),
    ).toBeInTheDocument()
    expect(api.askDocuments).toHaveBeenCalledWith(
      {
        question: 'How long are backups retained?',
        collection_id: 'group',
        document_id: 'doc',
        top_k: 5,
      },
      expect.any(AbortSignal),
    )
    expect(screen.getByText(/Generation 100 ms/)).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Open retention.pdf at page 2' }),
    )
    expect(await screen.findByRole('dialog')).toHaveTextContent('PDF page 2')
  })
  it('renders model output, filenames and excerpts as inert text', async () => {
    const attack =
      '<img src=x onerror=alert(1)><script>alert(2)</script> [run](javascript:alert(3))'
    vi.mocked(api.askDocuments).mockResolvedValue({
      ...answer,
      answer: attack,
      sources: [{ ...answer.sources[0], filename: attack, excerpt: attack }],
    })
    const view = mount()
    await question()
    await submit()
    await screen.findByRole('region', { name: 'Document answer' })
    expect(screen.getAllByText(attack).length).toBe(2)
    expect(
      view.container.querySelector('script, img, a[href^="javascript:"]'),
    ).toBeNull()
  })
  it('shows insufficient evidence without invented sources', async () => {
    vi.mocked(api.askDocuments).mockResolvedValue({
      ...answer,
      status: 'insufficient_evidence',
      answer: 'Not enough evidence.',
      sources: [],
      context_count: 0,
    })
    mount()
    await question()
    await submit()
    expect(await screen.findByText('INSUFFICIENT EVIDENCE')).toBeInTheDocument()
    expect(screen.queryByText('Retrieved sources')).not.toBeInTheDocument()
  })
  it('shows loading and prevents duplicate submissions', async () => {
    let finish!: (value: ChatResponse) => void
    vi.mocked(api.askDocuments).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    mount()
    await question()
    await submit()
    expect(screen.getByRole('status')).toHaveTextContent('Retrieving evidence')
    expect(
      screen.getByRole('button', { name: 'Preparing answer…' }),
    ).toBeDisabled()
    expect(screen.getByLabelText('Collection filter')).toBeDisabled()
    await act(async () => finish(answer))
    expect(api.askDocuments).toHaveBeenCalledOnce()
  })
  it('shows errors and permits another independent question', async () => {
    vi.mocked(api.askDocuments).mockRejectedValueOnce(
      new Error('Ollama is unavailable'),
    )
    mount()
    await question()
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ollama is unavailable',
    )
    await userEvent.clear(screen.getByLabelText('Your question'))
    await userEvent.type(
      screen.getByLabelText('Your question'),
      'Try another question',
    )
    await submit()
    expect(
      await screen.findByText('Backups last thirty days.'),
    ).toBeInTheDocument()
    expect(api.askDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: 'Try another question' }),
      expect.any(AbortSignal),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('clears selection and answer when scope changes', async () => {
    mount()
    await question()
    await userEvent.selectOptions(
      screen.getByLabelText('Document filter'),
      'doc',
    )
    await submit()
    await screen.findByText('Backups last thirty days.')
    await userEvent.selectOptions(
      screen.getByLabelText('Collection filter'),
      'group',
    )
    expect(screen.getByLabelText('Document filter')).toHaveValue('')
    expect(screen.queryByText('Backups last thirty days.')).toBeNull()
  })
  it('blocks blank input and unavailable filters', async () => {
    vi.mocked(api.listCollections).mockRejectedValue(
      new Error('Database unavailable'),
    )
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Database unavailable',
    )
    expect(screen.getByRole('button', { name: 'Ask documents' })).toBeDisabled()
    expect(api.askDocuments).not.toHaveBeenCalled()
  })
  it('aborts when leaving the page', async () => {
    vi.mocked(api.askDocuments).mockReturnValue(new Promise(() => {}))
    const view = mount()
    await question()
    await submit()
    const signal = vi.mocked(api.askDocuments).mock.calls[0][1]!
    view.unmount()
    expect(signal.aborted).toBe(true)
  })
  it('paginates document choices', async () => {
    vi.mocked(api.listSearchDocuments).mockResolvedValue({
      items: [document],
      total: 120,
      offset: 0,
      limit: 100,
    })
    mount()
    await question()
    await userEvent.click(
      screen.getByRole('button', { name: 'Next document options' }),
    )
    await waitFor(() =>
      expect(api.listSearchDocuments).toHaveBeenLastCalledWith(
        null,
        100,
        expect.any(AbortSignal),
      ),
    )
  })
})
