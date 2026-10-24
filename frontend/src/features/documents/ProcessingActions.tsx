import { useEffect, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { listDocumentChunks, processDocument } from '../../lib/api'
import type { ChunkPage, Document } from '../../types/library'

const labels = {
  uploaded: 'Uploaded',
  processing: 'Processing',
  processed: 'Processed',
  failed: 'Failed',
  no_text: 'No extractable text',
}

export function ProcessingStatus({ document }: { document: Document }) {
  return (
    <span
      className={`rounded px-2 py-0.5 ${document.processing_status === 'failed' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}
    >
      {labels[document.processing_status]}
    </span>
  )
}

export function ProcessingActions({
  document,
  onChanged,
}: {
  document: Document
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inspect, setInspect] = useState(false)
  const action =
    document.processing_status === 'processing'
      ? 'Retry expired processing'
      : document.processing_status === 'failed'
        ? 'Retry processing'
        : document.processing_status === 'uploaded'
          ? 'Process document'
          : 'Reprocess document'
  async function process() {
    setBusy(true)
    setError(null)
    try {
      await processDocument(document.id)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Processing failed; refresh the document status',
      )
    } finally {
      setBusy(false)
      onChanged()
    }
  }
  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void process()}
          aria-label={`${action} ${document.filename}`}
        >
          {busy ? 'Processing…' : action}
        </button>
        {(document.processing_status === 'processed' ||
          document.processing_status === 'no_text') && (
          <button
            type="button"
            className="text-forest underline"
            onClick={() => setInspect(true)}
          >
            Inspect text
          </button>
        )}
        {busy || document.processing_status === 'processing' ? (
          <span role="status">
            Extracting text. The original PDF is preserved.
          </span>
        ) : null}
      </div>
      {document.processing_status === 'processed' && (
        <p className="text-muted">
          {document.chunk_count} chunks · {document.page_count} pages
        </p>
      )}
      {document.processing_status === 'no_text' && (
        <p className="text-muted">
          No extractable text found. This may be a scanned PDF; OCR is not
          available.
        </p>
      )}
      {document.processing_error && (
        <p role="alert" className="text-red-800">
          {document.processing_error}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      {inspect && (
        <ChunkInspector document={document} onClose={() => setInspect(false)} />
      )}
    </div>
  )
}

export function ChunkInspector({
  document,
  onClose,
}: {
  document: Document
  onClose: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<ChunkPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    void listDocumentChunks(document.id, offset, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setPage(next)
          setError(null)
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : 'Unable to load chunks',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [document.id, offset])
  function move(next: number) {
    setLoading(true)
    setOffset(next)
  }
  return (
    <Dialog
      title={`Extracted text · ${document.filename}`}
      onClose={onClose}
      wide
    >
      <p className="mb-4 text-xs text-muted">
        Text is untrusted source content. Page numbers match the original PDF.
        Extraction uses no AI or OCR.
      </p>
      {error ? (
        <p role="alert" className="error-message">
          {error}
        </p>
      ) : loading ? (
        <p role="status">Loading chunks…</p>
      ) : !page?.items.length ? (
        <p>No extracted chunks.</p>
      ) : (
        <ol className="space-y-4">
          {page.items.map((chunk) => (
            <li key={chunk.id} className="rounded-xl border border-line p-4">
              <p className="mb-2 text-xs font-semibold text-forest">
                Page {chunk.page_number} · Chunk {chunk.chunk_index + 1}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                {chunk.text}
              </p>
            </li>
          ))}
        </ol>
      )}
      {page && page.total > page.limit && (
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            className="secondary-button"
            type="button"
            disabled={loading || offset === 0}
            onClick={() => move(Math.max(0, offset - page.limit))}
          >
            Previous chunks
          </button>
          <span className="text-xs">
            {offset + 1}–{Math.min(offset + page.limit, page.total)} of{' '}
            {page.total}
          </span>
          <button
            className="secondary-button"
            type="button"
            disabled={loading || offset + page.limit >= page.total}
            onClick={() => move(offset + page.limit)}
          >
            Next chunks
          </button>
        </div>
      )}
    </Dialog>
  )
}
