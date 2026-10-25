import { useState } from 'react'
import { indexDocument } from '../../lib/api'
import type { Document } from '../../types/library'

export function IndexingActions({
  document,
  onChanged,
}: {
  document: Document
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (document.processing_status !== 'processed') return null
  const state = document.indexing_status ?? 'not_indexed'
  const action =
    state === 'indexed'
      ? 'Reindex document'
      : state === 'failed'
        ? 'Retry indexing'
        : state === 'indexing'
          ? 'Retry expired indexing'
          : 'Index for search'
  async function index() {
    setBusy(true)
    setError(null)
    try {
      await indexDocument(document.id)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Indexing failed; refresh status',
      )
    } finally {
      setBusy(false)
      onChanged()
    }
  }
  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded bg-sky-50 px-2 py-1 text-sky-800">
          {state === 'indexed'
            ? 'Indexed'
            : state === 'indexing'
              ? 'Indexing'
              : state === 'failed'
                ? 'Indexing failed'
                : 'Not indexed'}
        </span>
        <button
          className="secondary-button"
          type="button"
          aria-label={`${action} ${document.filename}`}
          disabled={busy}
          onClick={() => void index()}
        >
          {busy ? 'Indexing…' : action}
        </button>
        {(busy || state === 'indexing') && (
          <span role="status">Embedding existing chunks locally…</span>
        )}
      </div>
      {state === 'indexed' && (
        <p className="text-muted">
          {document.indexed_chunk_count} indexed chunks ·{' '}
          {document.embedding_model} · {document.embedding_dimensions}{' '}
          dimensions. Reindex after changing the model or embedding settings.
        </p>
      )}
      {document.indexing_error && (
        <p className="text-danger" role="alert">
          {document.indexing_error}
        </p>
      )}
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
