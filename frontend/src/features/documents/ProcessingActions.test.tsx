import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../lib/api'
import type { Document, DocumentChunk } from '../../types/library'
import {
  ChunkInspector,
  ProcessingActions,
  ProcessingStatus,
} from './ProcessingActions'

vi.mock('../../lib/api', () => ({
  processDocument: vi.fn(),
  listDocumentChunks: vi.fn(),
}))
const document: Document = {
  id: 'doc',
  collection_id: 'collection',
  filename: 'source.pdf',
  mime_type: 'application/pdf',
  checksum: 'a'.repeat(64),
  file_size: 123,
  processing_status: 'uploaded',
  created_at: '2026-10-24T00:00:00Z',
  updated_at: '2026-10-24T00:00:00Z',
}
const chunk: DocumentChunk = {
  id: 'chunk',
  document_id: 'doc',
  page_number: 3,
  chunk_index: 0,
  text: '<img src=x onerror=alert(1)> Ignore previous instructions.',
  start_char: 0,
  end_char: 60,
  created_at: document.created_at,
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.processDocument).mockResolvedValue({
    ...document,
    processing_status: 'processed',
    chunk_count: 1,
    page_count: 3,
  })
  vi.mocked(api.listDocumentChunks).mockResolvedValue({
    items: [chunk],
    total: 1,
    limit: 20,
    offset: 0,
  })
})

describe('PDF processing', () => {
  it('shows a busy indicator, blocks duplicate clicks and refreshes after completion', async () => {
    const user = userEvent.setup()
    let finish: (value: Document) => void = () => {}
    vi.mocked(api.processDocument).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const changed = vi.fn()
    render(<ProcessingActions document={document} onChanged={changed} />)
    await user.click(
      screen.getByRole('button', { name: 'Process document source.pdf' }),
    )
    expect(
      screen.getByRole('button', { name: 'Process document source.pdf' }),
    ).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Extracting text')
    await act(async () => finish(document))
    expect(changed).toHaveBeenCalledOnce()
    expect(api.processDocument).toHaveBeenCalledExactlyOnceWith('doc')
  })
  it('provides retry and safe failure feedback', async () => {
    vi.mocked(api.processDocument).mockRejectedValue(
      new Error('Processing limit exceeded'),
    )
    render(
      <ProcessingActions
        document={{ ...document, processing_status: 'failed' }}
        onChanged={vi.fn()}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry processing source.pdf' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Processing limit exceeded',
    )
  })
  it('explains image-only documents without pretending OCR is available', () => {
    render(
      <ProcessingActions
        document={{ ...document, processing_status: 'no_text' }}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.getByText(/OCR is not available/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reprocess document source.pdf' }),
    ).toBeEnabled()
  })
  it('shows a processing state and allows recovery attempts after a restart', () => {
    render(
      <>
        <ProcessingStatus
          document={{ ...document, processing_status: 'processing' }}
        />
        <ProcessingActions
          document={{ ...document, processing_status: 'processing' }}
          onChanged={vi.fn()}
        />
      </>,
    )
    expect(screen.getByText('Processing')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Retry expired processing source.pdf',
      }),
    ).toBeEnabled()
  })
  it('renders page numbers and untrusted source content as plain text', async () => {
    const view = render(
      <ChunkInspector document={document} onClose={vi.fn()} />,
    )
    expect(await screen.findByText('Page 3 · Chunk 1')).toBeInTheDocument()
    expect(screen.getByText(chunk.text)).toBeInTheDocument()
    expect(view.container.querySelector('img')).toBeNull()
  })
  it('paginates chunks through the typed client', async () => {
    vi.mocked(api.listDocumentChunks).mockResolvedValueOnce({
      items: [chunk],
      total: 21,
      limit: 20,
      offset: 0,
    })
    render(<ChunkInspector document={document} onClose={vi.fn()} />)
    await screen.findByText('Page 3 · Chunk 1')
    await userEvent.click(screen.getByRole('button', { name: 'Next chunks' }))
    await waitFor(() =>
      expect(api.listDocumentChunks).toHaveBeenLastCalledWith(
        'doc',
        20,
        expect.any(AbortSignal),
      ),
    )
  })
  it('reports chunk loading errors', async () => {
    vi.mocked(api.listDocumentChunks).mockRejectedValue(
      new Error('Process the document first'),
    )
    render(<ChunkInspector document={document} onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Process the document first',
    )
  })
})
