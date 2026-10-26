import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import * as api from '../lib/api'
import type { Collection, Document } from '../types/library'
import { DocumentsPage } from './DocumentsPage'

vi.mock('../lib/api', () => ({
  listCollections: vi.fn(),
  listDocuments: vi.fn(),
  getLibraryConfig: vi.fn(),
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  deleteCollection: vi.fn(),
  uploadDocument: vi.fn(),
  renameDocument: vi.fn(),
  deleteDocument: vi.fn(),
  getDocumentPDF: vi.fn(),
  processDocument: vi.fn(),
  indexDocument: vi.fn(),
  listDocumentChunks: vi.fn(),
  documentDownloadUrl: (id: string) =>
    `/api/documents/${id}/file?download=true`,
}))

vi.mock('../features/documents/PdfPreview', () => ({
  default: ({ filename }: { filename: string }) => (
    <div role="img" aria-label={`PDF preview: ${filename}`} />
  ),
}))

const collection: Collection = {
  id: 'collection-1',
  name: 'Research',
  document_count: 1,
  created_at: '2026-10-24T00:00:00Z',
  updated_at: '2026-10-24T00:00:00Z',
}
const document: Document = {
  id: 'document-1',
  collection_id: collection.id,
  filename: 'paper.pdf',
  file_size: 800,
  mime_type: 'application/pdf',
  checksum: 'a'.repeat(64),
  processing_status: 'uploaded',
  created_at: collection.created_at,
  updated_at: collection.updated_at,
}

function mount() {
  return render(
    <MemoryRouter>
      <DocumentsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listCollections).mockResolvedValue([collection])
  vi.mocked(api.listDocuments).mockResolvedValue({
    items: [document],
    total: 1,
    limit: 20,
    offset: 0,
  })
  vi.mocked(api.getLibraryConfig).mockResolvedValue({
    max_upload_bytes: 25 * 1024 * 1024,
    max_pdf_pages: 2000,
  })
  vi.mocked(api.getDocumentPDF).mockResolvedValue(
    new Blob(['%PDF-fixture'], { type: 'application/pdf' }),
  )
})

describe('document library', () => {
  it('distinguishes processed text from a completed index without automatic mutations', async () => {
    vi.mocked(api.listDocuments).mockResolvedValue({
      items: [
        {
          ...document,
          processing_status: 'processed',
          indexing_status: 'not_indexed',
          chunk_count: 3,
          page_count: 2,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    })
    mount()
    expect(await screen.findByText('Processed')).toBeInTheDocument()
    expect(screen.getByText('Not indexed')).toBeInTheDocument()
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Index for search paper.pdf' }),
    ).toBeEnabled()
    expect(api.processDocument).not.toHaveBeenCalled()
    expect(api.indexDocument).not.toHaveBeenCalled()
  })
  it('supports responsive collection selection and hides the previous collection while loading', async () => {
    const empty = {
      ...collection,
      id: 'empty',
      name: 'Empty collection',
      document_count: 0,
    }
    vi.mocked(api.listCollections).mockResolvedValue([collection, empty])
    let finish!: (value: Awaited<ReturnType<typeof api.listDocuments>>) => void
    vi.mocked(api.listDocuments).mockImplementation((id) =>
      id === empty.id
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.resolve({
            items: [document],
            total: 1,
            limit: 20,
            offset: 0,
          }),
    )
    mount()
    await screen.findByText(document.filename)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Collection filter' }),
      empty.id,
    )
    expect(screen.queryByText(document.filename)).not.toBeInTheDocument()
    expect(screen.getByText('Loading your library…')).toBeInTheDocument()
    await waitFor(() =>
      expect(api.listDocuments).toHaveBeenLastCalledWith(
        empty.id,
        0,
        expect.any(AbortSignal),
      ),
    )
    finish({ items: [], total: 0, limit: 20, offset: 0 })
    expect(
      await screen.findByText('No PDFs in this collection yet'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Delete collection Empty collection',
      }),
    ).toBeEnabled()
  })
  it('never presents an unavailable initial library as an empty library', async () => {
    vi.mocked(api.listDocuments).mockRejectedValue(
      new Error('Database unavailable'),
    )
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Database unavailable',
    )
    expect(screen.getByText('Count unavailable')).toBeInTheDocument()
    expect(
      screen.queryByText('Room for your first PDF'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create your first collection' }),
    ).not.toBeInTheDocument()
    vi.mocked(api.listDocuments).mockResolvedValue({
      items: [document],
      total: 1,
      limit: 20,
      offset: 0,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(document.filename)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('preserves last-loaded data on refresh failure with an explicit warning', async () => {
    mount()
    await screen.findByText(document.filename)
    vi.mocked(api.listDocuments).mockRejectedValue(
      new Error('Temporarily unavailable'),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Refresh library' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Showing the last loaded data',
    )
    expect(screen.getByText(document.filename)).toBeInTheDocument()
  })
  it('uses server pagination and resets to the first page on a collection change', async () => {
    vi.mocked(api.listDocuments).mockImplementation((_id, offset) =>
      Promise.resolve({
        items:
          offset === 0
            ? Array.from({ length: 20 }, (_, i) => ({
                ...document,
                id: `doc-${i}`,
                filename: `Paper ${i + 1}.pdf`,
              }))
            : [{ ...document, id: 'last', filename: 'Last paper.pdf' }],
        total: 21,
        limit: 20,
        offset,
      }),
    )
    mount()
    await screen.findByText('1–20 of 21')
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('21–21 of 21')).toBeInTheDocument()
    expect(screen.getByText('Last paper.pdf')).toBeInTheDocument()
    expect(api.listDocuments).toHaveBeenLastCalledWith(
      null,
      20,
      expect.any(AbortSignal),
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Collection filter' }),
      collection.id,
    )
    await waitFor(() =>
      expect(api.listDocuments).toHaveBeenLastCalledWith(
        collection.id,
        0,
        expect.any(AbortSignal),
      ),
    )
    expect(await screen.findByText('1–20 of 21')).toBeInTheDocument()
  })
  it('confirms empty-collection deletion and preserves backend rejection feedback', async () => {
    vi.mocked(api.listCollections).mockResolvedValue([
      { ...collection, document_count: 0 },
    ])
    vi.mocked(api.listDocuments).mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    })
    mount()
    await screen.findByText('Room for your first PDF')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Collection filter' }),
      collection.id,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete collection Research' }),
    )
    expect(api.deleteCollection).not.toHaveBeenCalled()
    vi.mocked(api.deleteCollection).mockRejectedValue(
      new Error('Collection now contains documents'),
    )
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'now contains documents',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it('renames a selected collection and shows upload success without claiming indexing', async () => {
    mount()
    await screen.findByText(document.filename)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Collection filter' }),
      collection.id,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Rename collection Research' }),
    )
    await userEvent.clear(screen.getByLabelText('Collection name'))
    await userEvent.type(
      screen.getByLabelText('Collection name'),
      'Updated research',
    )
    vi.mocked(api.renameCollection).mockResolvedValue({
      ...collection,
      name: 'Updated research',
    })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.renameCollection).toHaveBeenCalledWith(
        collection.id,
        'Updated research',
      ),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Upload PDF' }))
    await userEvent.upload(
      screen.getByLabelText('Choose PDF'),
      new File(['%PDF-test'], 'new.pdf', { type: 'application/pdf' }),
    )
    vi.mocked(api.uploadDocument).mockResolvedValue({
      ...document,
      filename: 'new.pdf',
    })
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Upload PDF',
      }),
    )
    expect(
      await screen.findByText(
        'Uploaded “new.pdf”. Process text, then index for search when ready.',
      ),
    ).toBeInTheDocument()
  })
  it('processes an uploaded document and refreshes its status', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('button', { name: 'Process document paper.pdf' })
    const processed = {
      ...document,
      processing_status: 'processed' as const,
      page_count: 2,
      chunk_count: 3,
    }
    vi.mocked(api.processDocument).mockResolvedValue(processed)
    vi.mocked(api.listDocuments).mockResolvedValue({
      items: [processed],
      total: 1,
      limit: 20,
      offset: 0,
    })
    await user.click(
      screen.getByRole('button', { name: 'Process document paper.pdf' }),
    )
    expect(await screen.findByText('Processed')).toBeInTheDocument()
    expect(screen.getByText('3 chunks · 2 pages')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Inspect text' }),
    ).toBeInTheDocument()
  })
  it('creates a collection through the dialog', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('button', { name: 'Preview paper.pdf' })
    await user.click(screen.getByRole('button', { name: 'New collection' }))
    await user.type(screen.getByLabelText('Collection name'), 'Notes')
    vi.mocked(api.createCollection).mockResolvedValue({
      ...collection,
      id: 'notes',
      name: 'Notes',
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.createCollection).toHaveBeenCalledWith('Notes'),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('uploads a chosen PDF to the selected collection and refreshes', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Upload PDF' }))
    const file = new File(['%PDF-test'], 'new.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Choose PDF'), file)
    vi.mocked(api.uploadDocument).mockResolvedValue(document)
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Upload PDF',
      }),
    )
    await waitFor(() =>
      expect(api.uploadDocument).toHaveBeenCalledWith(collection.id, file),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('shows duplicate upload feedback and keeps the dialog open', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Upload PDF' }))
    await user.upload(
      screen.getByLabelText('Choose PDF'),
      new File(['pdf'], 'copy.pdf', { type: 'application/pdf' }),
    )
    vi.mocked(api.uploadDocument).mockRejectedValue(
      new Error('This PDF already exists in this collection'),
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Upload PDF',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('requires confirmation before deleting a document', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(
      await screen.findByLabelText('Document details for paper.pdf'),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Delete paper.pdf' }),
    )
    expect(api.deleteDocument).not.toHaveBeenCalled()
    vi.mocked(api.deleteDocument).mockResolvedValue(undefined)
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /^Delete$/,
      }),
    )
    await waitFor(() =>
      expect(api.deleteDocument).toHaveBeenCalledWith(document.id),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { name: 'All documents' })).toHaveFocus()
  })

  it('opens a PDF preview and download link', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(
      await screen.findByRole('button', { name: 'Preview paper.pdf' }),
    )
    expect(
      await screen.findByRole('img', { name: 'PDF preview: paper.pdf' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Download original' }),
    ).toHaveAttribute('href', '/api/documents/document-1/file?download=true')
  })

  it('renames a document through the typed API client', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(
      await screen.findByLabelText('Document details for paper.pdf'),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Rename paper.pdf' }),
    )
    await user.clear(screen.getByLabelText('PDF filename'))
    await user.type(screen.getByLabelText('PDF filename'), 'renamed.pdf')
    vi.mocked(api.renameDocument).mockResolvedValue({
      ...document,
      filename: 'renamed.pdf',
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.renameDocument).toHaveBeenCalledWith(
        document.id,
        'renamed.pdf',
      ),
    )
  })

  it('prevents deleting a nonempty collection and explains the restriction', async () => {
    mount()
    await userEvent.click(
      await screen.findByRole('button', { name: /^Research/ }),
    )
    expect(
      screen.getByRole('button', { name: 'Delete collection Research' }),
    ).toBeDisabled()
    expect(
      screen.getByText('Only empty collections can be deleted.'),
    ).toBeInTheDocument()
    expect(api.deleteCollection).not.toHaveBeenCalled()
  })

  it('shows an actionable empty state and network errors', async () => {
    vi.mocked(api.listCollections).mockResolvedValue([])
    vi.mocked(api.listDocuments).mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    })
    mount()
    expect(
      await screen.findByRole('button', {
        name: 'Create your first collection',
      }),
    ).toBeEnabled()
    vi.mocked(api.listDocuments).mockRejectedValue(
      new Error('Database unavailable'),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Refresh library' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Database unavailable',
    )
  })
})
