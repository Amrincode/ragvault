import { useEffect, useId, useRef, useState } from 'react'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { LoadingIndicator } from '../../components/ui/LoadingIndicator'
import { Icon } from '../../components/Icon'

type Loaded = {
  blob: Blob
  initialPage: number
  attempt: number
  pdf?: PDFDocumentProxy
  error?: string
}
const zoomLevels = [50, 75, 100, 125, 150, 175, 200]

export default function PdfPreview({
  blob,
  filename,
  initialPage = 1,
}: {
  blob: Blob
  filename: string
  initialPage?: number
}) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
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
        const pdf = await task.promise
        if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1)
          throw new Error('Invalid page count')
        if (!cancelled) setLoaded({ blob, initialPage, attempt, pdf })
      })
      .catch(() => {
        if (!cancelled)
          setLoaded({
            blob,
            initialPage,
            attempt,
            error:
              'PDF preview could not be loaded. Download the original to view it, or retry the preview.',
          })
      })
    return () => {
      cancelled = true
      if (task) void Promise.resolve(task.destroy()).catch(() => {})
    }
  }, [blob, initialPage, attempt])
  const current =
    loaded?.blob === blob &&
    Object.is(loaded.initialPage, initialPage) &&
    loaded.attempt === attempt
      ? loaded
      : null
  if (!current) return <LoadingIndicator label="Loading PDF pages…" />
  if (current.error)
    return (
      <div className="space-y-3">
        <p role="alert" className="error-message">
          {current.error}
        </p>
        <Button
          variant="secondary"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry PDF preview
        </Button>
      </div>
    )
  return (
    <PdfPageReader
      pdf={current.pdf!}
      filename={filename}
      initialPage={initialPage}
    />
  )
}

function PdfPageReader({
  pdf,
  filename,
  initialPage,
}: {
  pdf: PDFDocumentProxy
  filename: string
  initialPage: number
}) {
  const readerId = useId()
  const firstPage = Math.min(
    Math.max(1, Number.isSafeInteger(initialPage) ? initialPage : 1),
    pdf.numPages,
  )
  const [pageNumber, setPageNumber] = useState(firstPage)
  const [pageDraft, setPageDraft] = useState(String(firstPage))
  const [pageError, setPageError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [availableWidth, setAvailableWidth] = useState(600)
  const [attempt, setAttempt] = useState(0)
  const [image, setImage] = useState<{
    key: string
    width: number
    height: number
    scale: number
  } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null,
  )
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const renderQueue = useRef<Promise<void>>(Promise.resolve())
  const renderWidth = zoom === 'fit' ? availableWidth : 0
  const key = `${pageNumber}:${zoom}:${renderWidth}:${attempt}`
  const ready = image?.key === key
  const currentError = error?.key === key ? error.message : null

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => {
        if (entry?.contentRect.width > 0)
          setAvailableWidth(Math.max(1, Math.floor(entry.contentRect.width)))
      })
      observer.observe(element)
      return () => observer.disconnect()
    }
    const measure = () => {
      if (element.clientWidth > 24) setAvailableWidth(element.clientWidth - 24)
    }
    void Promise.resolve().then(measure)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    let cancelled = false
    let renderTask: RenderTask | null = null
    // Wait for a cancelled render to settle before resizing/reusing its canvas.
    const render = async () => {
      let page: PDFPageProxy | null = null
      try {
        if (cancelled) return
        page = await pdf.getPage(pageNumber)
        if (cancelled || !canvas.current) return
        const target = canvas.current
        const context = target.getContext('2d')
        if (!context) throw new Error('Canvas unavailable')
        const natural = page.getViewport({ scale: 1 })
        if (
          !Number.isFinite(natural.width) ||
          !Number.isFinite(natural.height) ||
          natural.width <= 0 ||
          natural.height <= 0
        )
          throw new Error('Invalid page dimensions')
        const scale = zoom === 'fit' ? renderWidth / natural.width : zoom / 100
        // Retain the existing 1.5x, 1200-by-1600 bitmap ceiling at every visual zoom.
        const rasterScale = Math.min(
          scale * Math.min(window.devicePixelRatio || 1, 2),
          1.5,
          1200 / natural.width,
          1600 / natural.height,
        )
        const raster = page.getViewport({ scale: rasterScale })
        target.width = Math.min(1200, Math.max(1, Math.ceil(raster.width)))
        target.height = Math.min(1600, Math.max(1, Math.ceil(raster.height)))
        renderTask = page.render({
          canvas: target,
          canvasContext: context,
          viewport: raster,
        })
        await renderTask.promise
        if (!cancelled) {
          setError(null)
          setImage({
            key,
            width: natural.width * scale,
            height: natural.height * scale,
            scale,
          })
        }
      } catch {
        if (!cancelled)
          setError({
            key,
            message:
              'This page could not be rendered. Retry this page, choose another page, or download the original to view it.',
          })
      } finally {
        try {
          page?.cleanup()
        } catch {
          /* The owning PDF worker may already be closed. */
        }
      }
    }
    renderQueue.current = renderQueue.current.then(render, render)
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdf, pageNumber, zoom, renderWidth, attempt, key])

  function goToPage(value: number) {
    setPageNumber(value)
    setPageDraft(String(value))
    setPageError(null)
    if (viewport.current) {
      viewport.current.scrollTop = 0
      viewport.current.scrollLeft = 0
    }
  }
  const effectiveZoom = zoom === 'fit' ? (image?.scale ?? 1) * 100 : zoom
  const changeZoom = (direction: -1 | 1) => {
    const next =
      direction === 1
        ? zoomLevels.find((level) => level > effectiveZoom + 0.1)
        : [...zoomLevels].reverse().find((level) => level < effectiveZoom - 0.1)
    if (next !== undefined) setZoom(next)
  }

  return (
    <div className="min-w-0 space-y-3">
      {firstPage !== initialPage && (
        <p
          role="status"
          className="rounded-control border border-warning-border bg-warning-soft p-3 text-sm text-warning"
        >
          The requested source page is outside this PDF. Opened page {firstPage}{' '}
          of {pdf.numPages}; check the original source reference.
        </p>
      )}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-canvas p-2">
        <form
          noValidate
          aria-label="PDF page navigation"
          className="flex min-w-0 flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const value = Number(pageDraft)
            if (
              !Number.isSafeInteger(value) ||
              value < 1 ||
              value > pdf.numPages
            ) {
              setPageError(
                `Enter a whole page number from 1 to ${pdf.numPages}.`,
              )
              return
            }
            goToPage(value)
          }}
        >
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous page"
            className="px-2!"
            title="Previous page"
            disabled={pageNumber === 1}
            onClick={() => goToPage(pageNumber - 1)}
          >
            <Icon name="previous" className="size-4" />
          </Button>
          <label className="flex items-center gap-2 text-meta">
            <span className="hidden sm:inline">Page</span>
            <Input
              aria-label="Page number"
              type="number"
              required
              min={1}
              max={pdf.numPages}
              step={1}
              value={pageDraft}
              aria-invalid={!!pageError || undefined}
              aria-describedby={
                pageError ? readerId + '-page-error' : undefined
              }
              className="w-20"
              onChange={(event) => {
                setPageDraft(event.target.value)
                setPageError(null)
              }}
            />
          </label>
          <span className="text-meta text-muted">of {pdf.numPages}</span>
          <Button type="submit" variant="secondary" size="sm" className="px-2!">
            Go
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next page"
            className="px-2!"
            title="Next page"
            disabled={pageNumber === pdf.numPages}
            onClick={() => goToPage(pageNumber + 1)}
          >
            <Icon name="next" className="size-4" />
          </Button>
        </form>
        <div
          className="flex min-w-0 flex-wrap items-center gap-2"
          role="group"
          aria-label="PDF zoom"
        >
          <Button
            variant="secondary"
            size="sm"
            aria-label="Zoom out"
            className="px-2!"
            title="Zoom out"
            disabled={!image || effectiveZoom <= 50}
            onClick={() => changeZoom(-1)}
          >
            <Icon name="minus" className="size-4" />
          </Button>
          <label className="sr-only" htmlFor={readerId + '-zoom'}>
            Zoom level
          </label>
          <select
            id={readerId + '-zoom'}
            className="text-input min-w-0 w-24"
            value={zoom}
            onChange={(event) =>
              setZoom(
                event.target.value === 'fit'
                  ? 'fit'
                  : Number(event.target.value),
              )
            }
          >
            <option value="fit">Fit width</option>
            {zoomLevels.map((level) => (
              <option key={level} value={level}>
                {level}%
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Zoom in"
            className="px-2!"
            title="Zoom in"
            disabled={!image || effectiveZoom >= 200}
            onClick={() => changeZoom(1)}
          >
            <Icon name="plus" className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Fit to width"
            title="Fit to width"
            className="px-2!"
            disabled={zoom === 'fit'}
            onClick={() => {
              setZoom('fit')
              if (viewport.current) viewport.current.scrollLeft = 0
            }}
          >
            <span aria-hidden="true" className="sm:hidden">
              Fit
            </span>
            <span aria-hidden="true" className="hidden sm:inline">
              Fit to width
            </span>
          </Button>
        </div>
      </div>
      {pageError && (
        <p
          id={readerId + '-page-error'}
          role="alert"
          className="text-sm text-danger"
        >
          {pageError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-meta text-muted">
        <span>
          Page {pageNumber} of {pdf.numPages}
        </span>
        {ready && (
          <span>
            {zoom === 'fit'
              ? `Fit width · ${Math.round(image.scale * 100)}%`
              : `Zoom ${zoom}%`}
          </span>
        )}
      </div>
      {currentError ? (
        <div className="space-y-2">
          <p role="alert" className="error-message">
            {currentError}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry page
          </Button>
        </div>
      ) : (
        !ready && <LoadingIndicator label="Rendering PDF page…" />
      )}
      <div
        ref={viewport}
        role="region"
        aria-label="PDF page viewport"
        tabIndex={0}
        className="max-h-[56dvh] min-h-44 min-w-0 overflow-auto rounded-control border border-line bg-canvas p-3 [scrollbar-gutter:stable] sm:max-h-[60dvh]"
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label={`PDF preview: ${filename}, page ${pageNumber}`}
          aria-hidden={!ready || !!currentError}
          className={`mx-auto block max-w-none bg-white shadow ${!ready || currentError ? 'invisible' : ''}`}
          style={
            image ? { width: image.width, height: image.height } : undefined
          }
        />
      </div>
    </div>
  )
}
