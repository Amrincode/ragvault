import { useState } from 'react'
import { indexDocument } from '../../lib/api'
import type { Document } from '../../types/library'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'

export function IndexingStatus({ document }: { document: Document }) {
  const state = document.indexing_status ?? 'not_indexed'
  return (
    <Badge
      tone={
        state === 'indexed'
          ? 'success'
          : state === 'failed'
            ? 'danger'
            : state === 'indexing'
              ? 'accent'
              : 'neutral'
      }
    >
      {
        {
          indexed: 'Indexed',
          failed: 'Indexing failed',
          indexing: 'Indexing',
          not_indexed: 'Not indexed',
        }[state]
      }
    </Badge>
  )
}

export function IndexingActions({
  document,
  onChanged,
  compact = false,
}: {
  document: Document
  onChanged: () => void
  compact?: boolean
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
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {!compact && <IndexingStatus document={document} />}
        <Button
          variant="secondary"
          size="sm"
          type="button"
          aria-label={`${action} ${document.filename}`}
          disabled={busy}
          onClick={() => void index()}
        >
          {busy ? 'Indexing…' : action}
        </Button>
        {(busy || state === 'indexing') && (
          <span role="status">Embedding existing chunks locally…</span>
        )}
      </div>
      {!compact && state === 'indexed' && (
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
