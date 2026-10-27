import { useState } from 'react'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../lib/api'
import type { Document } from '../../types/library'
import { PreviewDialog } from './LibraryDialogs'

const reader = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', () => ({
  getDocumentPDF: vi.fn(),
  documentDownloadUrl: (id: string) => '/original/' + id,
}))
vi.mock('./PdfPreview', () => ({
  default: (props: { filename: string; initialPage: number; blob: Blob }) => {
    reader(props)
    return (
      <div
        role="img"
        aria-label={`Reader: ${props.filename}, page ${props.initialPage}`}
      />
    )
  },
}))
const doc: Document = {
  id: 'owned-pdf',
  collection_id: 'owned-group',
  filename: 'synthetic.pdf',
  file_size: 1200,
  mime_type: 'application/pdf',
  checksum: 'a'.repeat(64),
  processing_status: 'processed',
  created_at: '2026-10-27T00:00:00Z',
  updated_at: '2026-10-27T00:00:00Z',
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.getDocumentPDF).mockResolvedValue(new Blob(['synthetic PDF']))
})

describe('Shared original PDF dialog', () => {
  it('loads the exact document and forwards the checked page without changing it', async () => {
    render(<PreviewDialog document={doc} initialPage={2} onClose={vi.fn()} />)
    await screen.findByRole('img', { name: 'Reader: synthetic.pdf, page 2' })
    expect(api.getDocumentPDF).toHaveBeenCalledWith(
      doc.id,
      expect.any(AbortSignal),
    )
    expect(
      screen.getByRole('link', { name: 'Download original' }),
    ).toHaveAttribute('href', '/original/' + doc.id)
  })
  it('retains the full long filename on demand and treats it as plain text', async () => {
    const filename =
      '<script>not markup</script>' + 'Synthetic-file-'.repeat(15) + '.pdf'
    const view = render(
      <PreviewDialog document={{ ...doc, filename }} onClose={vi.fn()} />,
    )
    await screen.findByRole('img')
    expect(screen.getByRole('heading', { name: filename })).toHaveAttribute(
      'title',
      filename,
    )
    await userEvent.click(screen.getByText('File details'))
    expect(
      screen.getAllByText(filename).some((element) => element.tagName === 'P'),
    ).toBe(true)
    expect(view.container.querySelector('script')).toBeNull()
  })
  it('keeps a download fallback and allows a failed file request to be retried', async () => {
    vi.mocked(api.getDocumentPDF).mockRejectedValueOnce(
      new Error('Original PDF unavailable'),
    )
    render(<PreviewDialog document={doc} onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Original PDF unavailable',
    )
    expect(
      screen.getByRole('link', { name: 'Download original' }),
    ).toBeInTheDocument()
    const oldSignal = vi.mocked(api.getDocumentPDF).mock.calls[0][1]!
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry original PDF' }),
    )
    await screen.findByRole('img')
    expect(oldSignal.aborted).toBe(true)
    expect(api.getDocumentPDF).toHaveBeenCalledTimes(2)
  })
  it('hides the previous blob while a different original PDF is loading', async () => {
    let finish!: (blob: Blob) => void
    const view = render(<PreviewDialog document={doc} onClose={vi.fn()} />)
    await screen.findByRole('img')
    vi.mocked(api.getDocumentPDF).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    view.rerender(
      <PreviewDialog
        document={{ ...doc, id: 'new-pdf', filename: 'new.pdf' }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('img')).toBeNull()
    await screen.findByText('Loading PDF preview…')
    await act(async () => finish(new Blob(['new PDF'])))
    await screen.findByRole('img', { name: 'Reader: new.pdf, page 1' })
    expect(reader).toHaveBeenLastCalledWith(
      expect.objectContaining({ filename: 'new.pdf' }),
    )
  })
  it('ignores an obsolete file response and aborts fetches on close', async () => {
    let finish!: (blob: Blob) => void
    vi.mocked(api.getDocumentPDF).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const view = render(<PreviewDialog document={doc} onClose={vi.fn()} />)
    const signal = vi.mocked(api.getDocumentPDF).mock.calls[0][1]!
    view.rerender(
      <PreviewDialog
        document={{ ...doc, id: 'new-pdf', filename: 'new.pdf' }}
        onClose={vi.fn()}
      />,
    )
    await screen.findByRole('img', { name: 'Reader: new.pdf, page 1' })
    await act(async () => finish(new Blob(['obsolete PDF'])))
    expect(signal.aborted).toBe(true)
    expect(screen.queryByRole('img', { name: /synthetic.pdf/ })).toBeNull()
    const current = vi.mocked(api.getDocumentPDF).mock.calls[1][1]!
    view.unmount()
    expect(current.aborted).toBe(true)
  })
  it('keeps initial focus on Close and restores the originating control on Escape', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Preview source</button>
          {open && (
            <PreviewDialog document={doc} onClose={() => setOpen(false)} />
          )}
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Preview source' })
    await userEvent.click(trigger)
    await screen.findByRole('img')
    const modal = screen.getByRole('dialog')
    expect(
      within(modal).getByRole('button', { name: 'Close dialog' }),
    ).toHaveFocus()
    fireEvent(modal, new Event('cancel', { bubbles: true, cancelable: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toHaveFocus()
  })
})
