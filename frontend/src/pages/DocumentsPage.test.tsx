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

  it('preserves a nonempty collection when deletion is rejected', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: /^Research/ }))
    await user.click(
      screen.getByRole('button', { name: 'Delete collection Research' }),
    )
    vi.mocked(api.deleteCollection).mockRejectedValue(
      new Error("Delete the collection's documents first"),
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /^Delete$/,
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'documents first',
    )
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
