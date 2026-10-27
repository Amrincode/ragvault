import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import type { Document } from '../types/library'
import type { SearchResponse } from '../types/search'
import { SearchPage } from './SearchPage'

vi.mock('../lib/api', () => ({
  listCollections: vi.fn(),
  listSearchDocuments: vi.fn(),
  searchPassages: vi.fn(),
  getDocument: vi.fn(),
}))
vi.mock('../features/documents/LibraryDialogs', () => ({
  PreviewDialog: ({ initialPage }: { initialPage: number }) => (
    <div role="dialog">Original PDF at page {initialPage}</div>
  ),
}))
const document: Document = {
  id: 'doc',
  collection_id: 'collection',
  filename: 'finance.pdf',
  file_size: 100,
  mime_type: 'application/pdf',
  checksum: 'a'.repeat(64),
  processing_status: 'processed',
  created_at: '2026-10-25T00:00:00Z',
  updated_at: '2026-10-25T00:00:00Z',
}
const result: SearchResponse = {
  items: [
    {
      document_id: 'doc',
      collection_id: 'collection',
      filename: 'finance.pdf',
      page_number: 2,
      chunk_id: 'chunk',
      excerpt: '<script>untrusted source</script> Revenue grew.',
      distance: 0.1,
      similarity: 0.9,
    },
  ],
  model: 'nomic-embed-text:latest',
  dimensions: 768,
  top_k: 5,
  elapsed_ms: 12,
  incompatible_documents: 0,
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listCollections).mockResolvedValue([
    {
      id: 'collection',
      name: 'Finance',
      document_count: 1,
      created_at: document.created_at,
      updated_at: document.updated_at,
    },
  ])
  vi.mocked(api.listSearchDocuments).mockResolvedValue({
    items: [document],
    total: 1,
    limit: 100,
    offset: 0,
  })
  vi.mocked(api.searchPassages).mockResolvedValue(result)
  vi.mocked(api.getDocument).mockResolvedValue(document)
})
function mount() {
  return render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>,
  )
}
async function query() {
  await screen.findByRole('option', { name: 'finance.pdf' })
  await userEvent.type(
    screen.getByLabelText('Search question'),
    'revenue growth',
  )
}

describe('semantic search', () => {
  it('clears a hidden document filter when paging document options', async () => {
    vi.mocked(api.listSearchDocuments).mockImplementation(
      async (_collection, offset) => ({
        items: [
          offset
            ? { ...document, id: 'next-doc', filename: 'next.pdf' }
            : document,
        ],
        total: 101,
        limit: 100,
        offset: offset ?? 0,
      }),
    )
    mount()
    await query()
    await userEvent.selectOptions(
      screen.getByLabelText('Document filter'),
      'doc',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Next document options' }),
    )
    await screen.findByRole('option', { name: 'next.pdf' })
    expect(screen.getByLabelText('Document filter')).toHaveValue('')
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    await waitFor(() =>
      expect(api.searchPassages).toHaveBeenCalledWith(
        expect.objectContaining({ document_id: null }),
        expect.any(AbortSignal),
      ),
    )
  })
  it('explains the source workflow and prevents empty queries', async () => {
    mount()
    await screen.findByRole('option', { name: 'finance.pdf' })
    expect(
      screen.getByRole('button', { name: 'Search passages' }),
    ).toBeDisabled()
    expect(screen.getByText(/no answer is generated/)).toBeInTheDocument()
    expect(api.searchPassages).not.toHaveBeenCalled()
  })
  it('submits server-side filters and renders escaped excerpts, names and page scores', async () => {
    const view = mount()
    await query()
    await userEvent.selectOptions(
      screen.getByLabelText('Collection filter'),
      'collection',
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Document filter')).toBeEnabled(),
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Document filter'),
      'doc',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    expect(await screen.findByText('Page 2 · Finance')).toBeInTheDocument()
    expect(screen.getByText('Cosine similarity 0.900')).toBeInTheDocument()
    expect(screen.getByText(result.items[0].excerpt)).toBeInTheDocument()
    expect(view.container.querySelector('script')).toBeNull()
    expect(api.searchPassages).toHaveBeenCalledWith(
      {
        query: 'revenue growth',
        top_k: 5,
        collection_id: 'collection',
        document_id: 'doc',
      },
      expect.any(AbortSignal),
    )
  })
  it('opens the original PDF on the cited page', async () => {
    mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Open original · Page 2: finance.pdf',
      }),
    )
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Original PDF at page 2',
    )
    expect(api.getDocument).toHaveBeenCalledWith('doc', expect.any(AbortSignal))
  })
  it('shows empty results without invented passages', async () => {
    vi.mocked(api.searchPassages).mockResolvedValue({ ...result, items: [] })
    mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    expect(
      await screen.findByText(/No matching indexed passages/),
    ).toBeInTheDocument()
  })
  it('reports upstream failures clearly', async () => {
    vi.mocked(api.searchPassages).mockRejectedValue(
      new Error('Embedding service unavailable'),
    )
    mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Embedding service unavailable',
    )
  })
  it('explains model-incompatible indexes', async () => {
    vi.mocked(api.searchPassages).mockResolvedValue({
      ...result,
      items: [],
      incompatible_documents: 2,
    })
    mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    expect(
      await screen.findByText(/2 indexed documents use a different/),
    ).toBeInTheDocument()
  })
  it('shows loading and blocks duplicate submissions', async () => {
    let finish: (value: SearchResponse) => void = () => {}
    vi.mocked(api.searchPassages).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Embedding your question',
    )
    await act(async () => finish(result))
    expect(api.searchPassages).toHaveBeenCalledOnce()
  })
  it('clears document selection when the collection changes', async () => {
    mount()
    await query()
    await userEvent.selectOptions(
      screen.getByLabelText('Document filter'),
      'doc',
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Collection filter'),
      'collection',
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Document filter')).toHaveValue(''),
    )
    expect(api.listSearchDocuments).toHaveBeenLastCalledWith(
      'collection',
      0,
      expect.any(AbortSignal),
    )
  })
  it('explains raw cosine similarity without presenting a confidence percentage', async () => {
    mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    expect(
      await screen.findByText(/not factual confidence or answer correctness/),
    ).toBeInTheDocument()
    expect(screen.getByText('Cosine similarity 0.900')).toBeInTheDocument()
    expect(screen.queryByText('90%')).toBeNull()
    expect(
      screen.getByRole('region', { name: 'Search results' }),
    ).toHaveTextContent(result.items[0].excerpt)
  })
  it('keeps displayed results tied to the submitted query while a new query is drafted', async () => {
    mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    await screen.findByRole('heading', { name: /Results for/ })
    await userEvent.clear(screen.getByLabelText('Search question'))
    await userEvent.type(
      screen.getByLabelText('Search question'),
      'A different draft',
    )
    expect(
      screen.getByRole('heading', { name: /Results for/ }),
    ).toHaveTextContent('revenue growth')
    expect(api.searchPassages).toHaveBeenCalledOnce()
  })
  it('blocks unavailable filters and retries them without silently broadening a scope', async () => {
    vi.mocked(api.listCollections).mockRejectedValueOnce(
      new Error('Filters unavailable'),
    )
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Filters unavailable',
    )
    await userEvent.type(
      screen.getByLabelText('Search question'),
      'Scoped question',
    )
    expect(
      screen.getByRole('button', { name: 'Search passages' }),
    ).toBeDisabled()
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry search filters' }),
    )
    await screen.findByRole('option', { name: 'finance.pdf' })
    expect(
      screen.getByRole('button', { name: 'Search passages' }),
    ).toBeEnabled()
    expect(api.searchPassages).not.toHaveBeenCalled()
  })
  it('submits the supported result limit and rejects a value outside its bounds', async () => {
    mount()
    await query()
    const limit = screen.getByRole('spinbutton', { name: 'Maximum results' })
    fireEvent.change(limit, { target: { value: '21' } })
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    expect(api.searchPassages).not.toHaveBeenCalled()
    fireEvent.change(limit, { target: { value: '3' } })
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    await waitFor(() =>
      expect(api.searchPassages).toHaveBeenCalledWith(
        expect.objectContaining({ top_k: 3 }),
        expect.any(AbortSignal),
      ),
    )
  })
  it('cancels a source lookup when filters change and ignores its late response', async () => {
    let finish!: (value: Document) => void
    vi.mocked(api.getDocument).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Open original · Page 2: finance.pdf',
      }),
    )
    const signal = vi.mocked(api.getDocument).mock.calls[0][1]!
    await userEvent.selectOptions(
      screen.getByLabelText('Collection filter'),
      'collection',
    )
    expect(signal.aborted).toBe(true)
    await act(async () => finish(document))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
  })
  it('reports an unavailable original without inventing a preview and permits a retry', async () => {
    vi.mocked(api.getDocument).mockRejectedValueOnce(
      new Error('Original PDF unavailable'),
    )
    mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    const button = await screen.findByRole('button', {
      name: 'Open original · Page 2: finance.pdf',
    })
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Original PDF unavailable',
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(button)
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Original PDF at page 2',
    )
  })
  it('aborts outstanding search and source requests when leaving the page', async () => {
    vi.mocked(api.searchPassages).mockReturnValueOnce(new Promise(() => {}))
    const view = mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    const signal = vi.mocked(api.searchPassages).mock.calls[0][1]!
    view.unmount()
    expect(signal.aborted).toBe(true)
  })
  it('retains complete long filenames, original excerpts and page metadata as inert text', async () => {
    const filename = 'Synthetic-long-filename-'.repeat(15) + '.pdf'
    vi.mocked(api.searchPassages).mockResolvedValue({
      ...result,
      items: [{ ...result.items[0], filename }],
    })
    const view = mount()
    await query()
    await userEvent.click(
      screen.getByRole('button', { name: 'Search passages' }),
    )
    expect(
      await screen.findByRole('heading', { name: filename }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Open original · Page 2: ' + filename,
      }),
    ).toBeInTheDocument()
    expect(view.container.querySelector('script')).toBeNull()
  })
})
