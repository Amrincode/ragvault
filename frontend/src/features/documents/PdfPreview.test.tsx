import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PdfPreview from './PdfPreview'

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  destroy: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: mocks.getDocument,
}))

function fixture() {
  const blob = new Blob(['%PDF-fixture'], { type: 'application/pdf' })
  Object.defineProperty(blob, 'arrayBuffer', {
    value: async () => new Uint8Array([37, 80, 68, 70]).buffer,
  })
  return blob
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  )
  mocks.getPage.mockResolvedValue({
    getViewport: () => ({ width: 600, height: 800 }),
    render: () => ({ promise: Promise.resolve(), cancel: mocks.cancel }),
  })
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 2, getPage: mocks.getPage }),
    destroy: mocks.destroy,
  })
})

describe('PDF page preview', () => {
  it('opens the page cited by semantic search', async () => {
    render(<PdfPreview blob={fixture()} filename="paper.pdf" initialPage={2} />)
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledWith(2))
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  })
  it('renders pages and navigates without extracting text', async () => {
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await waitFor(() =>
      expect(screen.queryByText('Rendering PDF page…')).not.toBeInTheDocument(),
    )
    expect(
      screen.getByRole('img', { name: 'PDF preview: paper.pdf, page 1' }),
    ).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledWith(2))
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  })

  it('reports parser failures with a download fallback', async () => {
    mocks.getDocument.mockReturnValue({
      promise: Promise.reject(new Error('Invalid PDF')),
      destroy: mocks.destroy,
    })
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Download the original',
    )
  })

  it('releases the worker when preview closes', async () => {
    const view = render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledWith(1))
    view.unmount()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
})
