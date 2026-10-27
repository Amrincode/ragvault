import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PdfPreview from './PdfPreview'

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  destroy: vi.fn(),
  cancel: vi.fn(),
  cleanup: vi.fn(),
  render: vi.fn(),
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
function page(width = 600, height = 800) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    }),
    render: mocks.render,
    cleanup: mocks.cleanup,
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  )
  mocks.render.mockImplementation(() => ({
    promise: Promise.resolve(),
    cancel: mocks.cancel,
  }))
  mocks.getPage.mockImplementation(async () => page())
  mocks.getDocument.mockImplementation(() => ({
    promise: Promise.resolve({ numPages: 2, getPage: mocks.getPage }),
    destroy: mocks.destroy,
  }))
})
afterEach(() => vi.unstubAllGlobals())
const rendered = (number = 1) =>
  screen.findByRole('img', { name: `PDF preview: paper.pdf, page ${number}` })

describe('PDF page reader', () => {
  it('opens the exact original page cited by semantic search', async () => {
    render(<PdfPreview blob={fixture()} filename="paper.pdf" initialPage={2} />)
    await rendered(2)
    expect(mocks.getPage).toHaveBeenCalledWith(2)
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })
  it('navigates one page at a time without reloading or extracting the document', async () => {
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await rendered()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await rendered(2)
    expect(mocks.getDocument).toHaveBeenCalledOnce()
    expect(mocks.getPage.mock.calls.map((call) => call[0])).toEqual([1, 2])
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    expect(mocks.cleanup).toHaveBeenCalledTimes(2)
  })
  it('supports direct page entry with Enter and updates the visible page count', async () => {
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await rendered()
    const input = screen.getByRole('spinbutton', { name: 'Page number' })
    await userEvent.clear(input)
    await userEvent.type(input, '2{Enter}')
    await rendered(2)
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(input).toHaveValue(2)
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await rendered(1)
    expect(input).toHaveValue(1)
  })
  it.each(['0', '3', '1.5', ''])(
    'rejects invalid direct page entry "%s" without inventing a page',
    async (value) => {
      render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
      await rendered()
      fireEvent.change(
        screen.getByRole('spinbutton', { name: 'Page number' }),
        { target: { value } },
      )
      await userEvent.click(screen.getByRole('button', { name: 'Go' }))
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Enter a whole page number from 1 to 2.',
      )
      expect(mocks.getPage).toHaveBeenCalledOnce()
      expect(
        screen.getByRole('spinbutton', { name: 'Page number' }),
      ).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
      expect(await rendered()).toBeVisible()
    },
  )
  it.each([9, -2, Number.NaN])(
    'makes an out-of-bounds source page explicit: %s',
    async (initialPage) => {
      render(
        <PdfPreview
          blob={fixture()}
          filename="paper.pdf"
          initialPage={initialPage}
        />,
      )
      await rendered(initialPage > 2 ? 2 : 1)
      expect(
        screen.getByText(/requested source page is outside this PDF/),
      ).toBeInTheDocument()
      expect(mocks.getPage).not.toHaveBeenCalledWith(initialPage)
    },
  )
  it('retains visual zoom across page changes and restores fit-to-width on demand', async () => {
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await rendered()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Zoom level' }),
      '150',
    )
    await waitFor(() =>
      expect(screen.getByText('Zoom 150%')).toBeInTheDocument(),
    )
    expect(await rendered()).toHaveStyle({ width: '900px', height: '1200px' })
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await rendered(2)
    expect(screen.getByRole('combobox', { name: 'Zoom level' })).toHaveValue(
      '150',
    )
    expect(mocks.getDocument).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Fit to width' }))
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Zoom level' })).toHaveValue(
        'fit',
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Fit to width' }),
      ).toBeDisabled(),
    )
  })
  it('keeps bitmap dimensions bounded at 200% visual zoom on a large page', async () => {
    mocks.getPage.mockImplementation(async () => page(6000, 8000))
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await rendered()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Zoom level' }),
      '200',
    )
    await screen.findByText('Zoom 200%')
    const canvas = (await rendered()) as HTMLCanvasElement
    expect(canvas.width).toBeLessThanOrEqual(1200)
    expect(canvas.height).toBeLessThanOrEqual(1600)
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Zoom level' }),
      '50',
    )
    await screen.findByText('Zoom 50%')
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
  })
  it('steps zoom without exceeding the selectable range', async () => {
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await rendered()
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    await screen.findByText('Zoom 125%')
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    await screen.findByText('Zoom 100%')
  })
  it('refits after a viewport resize and disconnects its observer on close', async () => {
    let resize!: ResizeObserverCallback
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    const view = render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await rendered()
    act(() =>
      resize(
        [{ contentRect: { width: 300 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
    )
    await waitFor(async () =>
      expect(await rendered()).toHaveStyle({ width: '300px' }),
    )
    act(() =>
      resize(
        [{ contentRect: { width: 700 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
    )
    await waitFor(async () =>
      expect(await rendered()).toHaveStyle({ width: '700px' }),
    )
    view.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it('does not rerender numeric zoom when scrollbar or viewport width changes', async () => {
    let resize!: ResizeObserverCallback
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await rendered()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Zoom level' }),
      '200',
    )
    await screen.findByText('Zoom 200%')
    const calls = mocks.render.mock.calls.length
    await act(async () =>
      resize(
        [{ contentRect: { width: 385 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
    )
    expect(mocks.render).toHaveBeenCalledTimes(calls)
    expect(await rendered()).toBeVisible()
    expect(await rendered()).toHaveStyle({ width: '1200px', height: '1600px' })
  })
  it('retries parser failure and keeps PDF resources local with XFA disabled', async () => {
    mocks.getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('Invalid PDF')),
      destroy: mocks.destroy,
    }))
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Download the original',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry PDF preview' }),
    )
    await rendered()
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.getDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enableXfa: false,
        cMapUrl: '/pdfjs/cmaps/',
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
      }),
    )
  })
  it('retries a page-render failure without reloading the PDF', async () => {
    mocks.render.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('Render error')),
      cancel: mocks.cancel,
    }))
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not be rendered',
    )
    expect(screen.queryByRole('img')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Retry page' }))
    await rendered()
    expect(mocks.getDocument).toHaveBeenCalledOnce()
    expect(mocks.cleanup).toHaveBeenCalledTimes(2)
  })
  it('clears an earlier render error after navigating away and successfully returning', async () => {
    mocks.render.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('Transient render failure')),
      cancel: mocks.cancel,
    }))
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await rendered(2)
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await rendered(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mocks.getDocument).toHaveBeenCalledOnce()
  })
  it('cancels and settles an in-flight render before reusing its canvas for another page', async () => {
    let reject!: (error: Error) => void
    mocks.render.mockReturnValueOnce({
      promise: new Promise((_resolve, fail) => {
        reject = fail
      }),
      cancel: () => {
        mocks.cancel()
        reject(new Error('RenderingCancelledException'))
      },
    })
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce())
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await rendered(2)
    expect(mocks.cancel).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mocks.cleanup).toHaveBeenCalledTimes(2)
  })
  it('discards and cleans a late page lookup after the requested page changes', async () => {
    let finish!: (value: ReturnType<typeof page>) => void
    mocks.getPage.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledWith(1))
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await act(async () => finish(page()))
    await rendered(2)
    expect(mocks.render).toHaveBeenCalledOnce()
    expect(mocks.cleanup).toHaveBeenCalledTimes(2)
  })
  it('cancels rendering and destroys its worker on close, without publishing a late image', async () => {
    let reject!: (error: Error) => void
    mocks.render.mockReturnValueOnce({
      promise: new Promise((_resolve, fail) => {
        reject = fail
      }),
      cancel: () => {
        mocks.cancel()
        reject(new Error('cancelled'))
      },
    })
    const view = render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce())
    view.unmount()
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.cancel).toHaveBeenCalledOnce()
    await waitFor(() => expect(mocks.cleanup).toHaveBeenCalledOnce())
  })
  it('ignores a late PDF load after close', async () => {
    let finish!: (value: {
      numPages: number
      getPage: typeof mocks.getPage
    }) => void
    mocks.getDocument.mockReturnValue({
      promise: new Promise((resolve) => {
        finish = resolve
      }),
      destroy: mocks.destroy,
    })
    const view = render(<PdfPreview blob={fixture()} filename="paper.pdf" />)
    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => finish({ numPages: 2, getPage: mocks.getPage }))
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.getPage).not.toHaveBeenCalled()
  })
})
