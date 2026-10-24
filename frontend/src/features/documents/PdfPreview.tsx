import { useEffect, useRef, useState } from 'react'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export default function PdfPreview({
  blob,
  filename,
  initialPage = 1,
}: {
  blob: Blob
  filename: string
  initialPage?: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [renderedPage, setRenderedPage] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    void Promise.all([import('pdfjs-dist'), blob.arrayBuffer()])
      .then(async ([library, bytes]) => {
        if (cancelled) return
        library.GlobalWorkerOptions.workerSrc = workerUrl
        task = library.getDocument({
          data: new Uint8Array(bytes),
          enableXfa: false,
          cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
          wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
        })
        const document = await task.promise
        if (!cancelled) {
          setPageNumber(Math.min(Math.max(1, initialPage), document.numPages))
          setPdf(document)
        }
      })
      .catch(() => {
        if (!cancelled)
          setError(
            'PDF preview could not be loaded. Download the original to view it.',
          )
      })
    return () => {
      cancelled = true
      if (task) void task.destroy()
    }
  }, [blob, initialPage])

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    let renderTask: RenderTask | null = null
    void pdf
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled || !canvas.current) return
        const target = canvas.current
        const context = target.getContext('2d')
        if (!context) throw new Error('Canvas is unavailable')
        const natural = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({
          scale: Math.min(1.5, 1200 / natural.width, 1600 / natural.height),
        })
        target.width = Math.ceil(viewport.width)
        target.height = Math.ceil(viewport.height)
        renderTask = page.render({
          canvas: target,
          canvasContext: context,
          viewport,
        })
        await renderTask.promise
        if (!cancelled) setRenderedPage(pageNumber)
      })
      .catch(() => {
        if (!cancelled)
          setError(
            'This page could not be rendered. Download the original to view it.',
          )
      })
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdf, pageNumber])

  if (error)
    return (
      <p role="alert" className="error-message">
        {error}
      </p>
    )
  return (
    <div>
      <div className="mb-3 flex items-center justify-center gap-4">
        <button
          type="button"
          className="secondary-button"
          disabled={!pdf || pageNumber === 1 || renderedPage !== pageNumber}
          onClick={() => setPageNumber((value) => value - 1)}
        >
          Previous page
        </button>
        <span className="text-xs text-muted">
          Page {pageNumber} of {pdf?.numPages ?? '…'}
        </span>
        <button
          type="button"
          className="secondary-button"
          disabled={
            !pdf || pageNumber === pdf.numPages || renderedPage !== pageNumber
          }
          onClick={() => setPageNumber((value) => value + 1)}
        >
          Next page
        </button>
      </div>
      {renderedPage !== pageNumber && (
        <p role="status" className="mb-3 text-center text-xs text-muted">
          Rendering PDF page…
        </p>
      )}
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-stone-100 p-3">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`PDF preview: ${filename}, page ${pageNumber}`}
          className={`mx-auto h-auto max-w-full bg-white shadow ${renderedPage !== pageNumber ? 'invisible' : ''}`}
        />
      </div>
    </div>
  )
}
