import { useId } from 'react'
import { Icon } from '../../components/Icon'
import { Button } from '../../components/ui/Button'
import { ProcessingActions, ProcessingStatus } from './ProcessingActions'
import { IndexingActions, IndexingStatus } from './IndexingActions'
import { documentDownloadUrl } from '../../lib/api'
import { formatBytes } from '../../lib/format'
import type { Document } from '../../types/library'

export function DocumentRow({
  document: item,
  collection,
  onPreview,
  onRename,
  onDelete,
  onChanged,
}: {
  document: Document
  collection: string
  onPreview: () => void
  onRename: () => void
  onDelete: () => void
  onChanged: () => void
}) {
  const heading = useId()
  return (
    <li className="p-5 sm:p-6" aria-labelledby={heading}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-full items-start gap-3 sm:basis-0">
          <span className="grid size-11 shrink-0 place-items-center rounded-card bg-accent-soft text-accent">
            <Icon name="documents" className="size-6" />
          </span>
          <div className="min-w-0">
            <h3
              id={heading}
              className="break-words text-base font-semibold [overflow-wrap:anywhere]"
            >
              {item.filename}
            </h3>
            <p className="mt-1 break-words text-meta text-muted [overflow-wrap:anywhere]">
              {collection}
            </p>
            <p className="mt-1 text-meta text-muted">
              {formatBytes(item.file_size)} <span aria-hidden="true">·</span>{' '}
              Uploaded{' '}
              <time dateTime={item.created_at}>
                {new Date(item.created_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </time>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Preview ${item.filename}`}
            onClick={onPreview}
          >
            Preview
          </Button>
          <a
            className="button"
            data-variant="ghost"
            data-size="sm"
            href={documentDownloadUrl(item.id)}
            aria-label={`Download ${item.filename}`}
            target="_blank"
            rel="noreferrer"
          >
            Download
            <Icon name="arrow" className="size-3.5" />
          </a>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-meta">
        <div className="flex items-center gap-2">
          <span className="text-muted">Text</span>
          <ProcessingStatus document={item} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted">Search</span>
          <IndexingStatus document={item} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-start gap-x-3 gap-y-3">
        <ProcessingActions document={item} compact onChanged={onChanged} />
        <IndexingActions document={item} compact onChanged={onChanged} />
      </div>
      <details className="mt-4 border-t border-line pt-2">
        <summary
          className="w-fit cursor-pointer rounded-control py-2 text-sm font-medium text-muted hover:text-accent"
          aria-label={`Document details for ${item.filename}`}
        >
          Document details
        </summary>
        <dl className="mt-3 grid gap-4 text-meta sm:grid-cols-2">
          <div>
            <dt className="text-muted">Extracted text</dt>
            <dd className="mt-1">
              {item.processing_status === 'processed' ||
              item.processing_status === 'no_text'
                ? `${item.chunk_count ?? 0} chunks · ${item.page_count ?? 0} pages`
                : 'Not available yet'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Search embeddings</dt>
            <dd className="mt-1 break-words [overflow-wrap:anywhere]">
              {item.indexing_status === 'indexed'
                ? `${item.indexed_chunk_count ?? 0} indexed chunks · ${item.embedding_model ?? 'Unknown model'} · ${item.embedding_dimensions ?? 'Unknown'} dimensions`
                : 'No completed index'}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">SHA-256 checksum</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {item.checksum}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-meta text-muted">
          Reprocessing replaces extracted text and clears its search index.
          Index again afterward. Reindex when changing embedding settings.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Rename ${item.filename}`}
            onClick={onRename}
          >
            Rename
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            aria-label={`Delete ${item.filename}`}
            onClick={onDelete}
          >
            Delete document
          </Button>
        </div>
      </details>
    </li>
  )
}
