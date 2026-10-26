import { useEffect, useRef, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { FormField } from '../components/ui/FormField'
import { LoadingIndicator } from '../components/ui/LoadingIndicator'
import {
  DeleteDialog,
  NameDialog,
  PreviewDialog,
  UploadDialog,
} from '../features/documents/LibraryDialogs'
import { DocumentRow } from '../features/documents/DocumentRow'
import { useLibrary } from '../hooks/useLibrary'
import {
  createCollection,
  deleteCollection,
  deleteDocument,
  renameCollection,
  renameDocument,
} from '../lib/api'
import type { Collection, Document } from '../types/library'

type ActiveDialog =
  | { type: 'create' }
  | { type: 'upload' }
  | { type: 'renameCollection' | 'deleteCollection'; item: Collection }
  | { type: 'renameDocument' | 'deleteDocument' | 'preview'; item: Document }

export function DocumentsPage() {
  const [selected, setSelected] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [dialog, setDialog] = useState<ActiveDialog | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusAfterDelete = useRef(false)
  const { collections, documents, config, loading, error, hasData, reload } =
    useLibrary(selected, offset)
  const selectedCollection = collections.find((item) => item.id === selected)
  const total = collections.reduce((sum, item) => sum + item.document_count, 0)
  const canUpload = !!collections.length && !!config && !loading
  function selectCollection(id: string | null) {
    setSelected(id)
    setOffset(0)
  }
  function changed(message?: string) {
    setOffset(0)
    reload()
    if (message) setNotice(message)
  }
  const close = () => setDialog(null)
  useEffect(() => {
    if (!dialog && focusAfterDelete.current) {
      document.getElementById('documents-heading')?.focus()
      focusAfterDelete.current = false
    }
  })
  return (
    <AppShell page="Documents">
      <section
        aria-labelledby="library-title"
        className="flex flex-wrap items-start justify-between gap-5"
      >
        <div>
          <p className="eyebrow">YOUR LOCAL KNOWLEDGE</p>
          <h1 id="library-title" className="mt-2 text-page">
            Document library
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Keep your PDFs organized, explore the originals, and prepare them
            for local AI.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!canUpload}
            onClick={() => setDialog({ type: 'upload' })}
          >
            <Icon name="upload" className="size-4" />
            Upload PDF
          </Button>
          <Button
            variant="secondary"
            onClick={() => setDialog({ type: 'create' })}
          >
            <Icon name="plus" className="size-4" />
            New collection
          </Button>
        </div>
      </section>
      <div className="mt-6 flex items-start gap-3 rounded-control border border-line bg-surface px-4 py-3 text-meta leading-6 text-muted">
        <Icon name="lock" className="mt-1 size-4 text-accent" />
        <p>
          PDFs stay on this machine.{' '}
          <span className="font-medium text-ink">
            Processing extracts text; indexing makes it searchable.
          </span>{' '}
          Uploading does neither automatically.
        </p>
      </div>
      {notice && (
        <div
          role="status"
          className="mt-4 flex items-start justify-between gap-3 rounded-control border border-line bg-success-soft px-4 py-3 text-sm text-success"
        >
          <p className="min-w-0 break-words [overflow-wrap:anywhere]">
            {notice}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" className="size-4" />
          </Button>
        </div>
      )}
      <div className="mt-7 grid items-start gap-6 xl:grid-cols-[208px_minmax(0,1fr)]">
        <aside aria-label="Collections" className="hidden xl:block">
          <Card className="p-3">
            <div className="mb-3 flex items-center justify-between gap-2 px-2">
              <h2 className="text-sm font-semibold">Collections</h2>
              {hasData && <Badge>{collections.length}</Badge>}
            </div>
            <button
              type="button"
              onClick={() => selectCollection(null)}
              aria-pressed={selected === null}
              className={`collection-button min-h-11 text-sm ${selected === null ? 'bg-accent-soft text-accent' : 'hover:bg-canvas'}`}
            >
              <span>All documents</span>
              <span className="tabular-nums">{hasData ? total : '—'}</span>
            </button>
            {collections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectCollection(item.id)}
                aria-pressed={selected === item.id}
                className={`collection-button mt-1 min-h-11 text-sm ${selected === item.id ? 'bg-accent-soft text-accent' : 'hover:bg-canvas'}`}
              >
                <span className="min-w-0 break-words text-left [overflow-wrap:anywhere]">
                  {item.name}
                </span>
                <span className="shrink-0 tabular-nums">
                  {item.document_count}
                </span>
              </button>
            ))}
            {!loading && !error && !collections.length && (
              <p className="px-2 py-4 text-meta leading-5 text-muted">
                Create a collection to keep related PDFs together.
              </p>
            )}
          </Card>
        </aside>
        <section className="min-w-0" aria-labelledby="documents-heading">
          <div className="mb-5 xl:hidden">
            <FormField label="Collection filter">
              <select
                className="text-input"
                value={selected ?? ''}
                onChange={(event) =>
                  selectCollection(event.target.value || null)
                }
              >
                <option value="">
                  All documents{hasData ? ` (${total})` : ''}
                </option>
                {collections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.document_count})
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="documents-heading"
                tabIndex={-1}
                className="break-words text-section [overflow-wrap:anywhere]"
              >
                {selectedCollection?.name ??
                  (selected ? 'Selected collection' : 'All documents')}
              </h2>
              <p className="mt-1 text-meta text-muted">
                {hasData
                  ? `${documents.total.toLocaleString()} ${documents.total === 1 ? 'document' : 'documents'}`
                  : loading
                    ? 'Loading documents…'
                    : 'Count unavailable'}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={reload}
            >
              <Icon
                name="refresh"
                className={`size-4 ${loading ? 'animate-spin' : ''}`}
              />
              Refresh library
            </Button>
          </div>
          {selectedCollection && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Rename collection ${selectedCollection.name}`}
                onClick={() =>
                  setDialog({
                    type: 'renameCollection',
                    item: selectedCollection,
                  })
                }
              >
                Rename collection
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                disabled={selectedCollection.document_count > 0}
                aria-describedby="collection-delete-hint"
                aria-label={`Delete collection ${selectedCollection.name}`}
                onClick={() =>
                  setDialog({
                    type: 'deleteCollection',
                    item: selectedCollection,
                  })
                }
              >
                Delete collection
              </Button>
              <p id="collection-delete-hint" className="text-meta text-muted">
                Only empty collections can be deleted.
              </p>
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-control border border-danger-border bg-danger-soft p-4 text-sm text-danger"
            >
              <h3 className="font-semibold">Library could not be refreshed</h3>
              <p className="mt-1 break-words [overflow-wrap:anywhere]">
                {error}
              </p>
              {hasData && (
                <p className="mt-1">
                  Showing the last loaded data for this view.
                </p>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={reload}
              >
                Retry
              </Button>
            </div>
          )}
          {loading && (
            <div className="mb-4 rounded-control border border-line bg-surface p-5">
              <LoadingIndicator
                label={
                  hasData ? 'Refreshing your library…' : 'Loading your library…'
                }
              />
            </div>
          )}
          {hasData &&
            (!documents.items.length ? (
              <Card className="p-0">
                <EmptyState
                  title={
                    selectedCollection
                      ? 'No PDFs in this collection yet'
                      : 'Room for your first PDF'
                  }
                  description={
                    collections.length
                      ? 'Upload a PDF to preview the original. Process its text, then index it when you want to search or chat.'
                      : 'Create a collection for related documents, then add your first PDF.'
                  }
                  icon={<Icon name="documents" />}
                  action={
                    <Button
                      disabled={loading || (!!collections.length && !config)}
                      onClick={() =>
                        setDialog({
                          type: collections.length ? 'upload' : 'create',
                        })
                      }
                    >
                      {collections.length
                        ? 'Upload your first PDF'
                        : 'Create your first collection'}
                    </Button>
                  }
                />
              </Card>
            ) : (
              <Card className="overflow-hidden p-0">
                <ul className="divide-y divide-line">
                  {documents.items.map((item) => (
                    <DocumentRow
                      key={item.id}
                      document={item}
                      collection={
                        collections.find(
                          (group) => group.id === item.collection_id,
                        )?.name ?? 'Collection unavailable'
                      }
                      onPreview={() => setDialog({ type: 'preview', item })}
                      onRename={() =>
                        setDialog({ type: 'renameDocument', item })
                      }
                      onDelete={() =>
                        setDialog({ type: 'deleteDocument', item })
                      }
                      onChanged={reload}
                    />
                  ))}
                </ul>
              </Card>
            ))}
          {hasData && documents.total > documents.limit && (
            <nav
              aria-label="Document pages"
              className="mt-5 flex flex-wrap items-center justify-between gap-3 text-meta text-muted"
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={offset === 0 || loading}
                onClick={() =>
                  setOffset((value) => Math.max(0, value - documents.limit))
                }
              >
                Previous
              </Button>
              <span>
                {offset + 1}–
                {Math.min(offset + documents.limit, documents.total)} of{' '}
                {documents.total}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  offset + documents.limit >= documents.total || loading
                }
                onClick={() => setOffset((value) => value + documents.limit)}
              >
                Next
              </Button>
            </nav>
          )}
        </section>
      </div>
      {dialog?.type === 'create' && (
        <NameDialog
          title="Create collection"
          label="Collection name"
          onClose={close}
          onSave={async (name) => {
            const item = await createCollection(name)
            selectCollection(item.id)
            changed('Collection created.')
          }}
        />
      )}
      {dialog?.type === 'renameCollection' && (
        <NameDialog
          title="Rename collection"
          label="Collection name"
          initialValue={dialog.item.name}
          onClose={close}
          onSave={async (name) => {
            await renameCollection(dialog.item.id, name)
            changed('Collection renamed.')
          }}
        />
      )}
      {dialog?.type === 'deleteCollection' && (
        <DeleteDialog
          title="Delete collection?"
          description={`Delete “${dialog.item.name}”? Only empty collections can be deleted. Delete its documents individually first.`}
          onClose={close}
          onConfirm={async () => {
            await deleteCollection(dialog.item.id)
            focusAfterDelete.current = true
            selectCollection(null)
            changed('Empty collection deleted.')
          }}
        />
      )}
      {dialog?.type === 'renameDocument' && (
        <NameDialog
          title="Rename document"
          label="PDF filename"
          filename
          initialValue={dialog.item.filename}
          onClose={close}
          onSave={async (name) => {
            await renameDocument(dialog.item.id, name)
            changed('Document renamed. Original file contents are unchanged.')
          }}
        />
      )}
      {dialog?.type === 'deleteDocument' && (
        <DeleteDialog
          title="Delete document?"
          description={`Permanently delete “${dialog.item.filename}”, its stored PDF, extracted text, and search embeddings? This cannot be undone.`}
          onClose={close}
          onConfirm={async () => {
            await deleteDocument(dialog.item.id)
            focusAfterDelete.current = true
            changed('Document deleted.')
          }}
        />
      )}
      {dialog?.type === 'upload' && config && (
        <UploadDialog
          collections={collections}
          selectedId={selected}
          config={config}
          onUploaded={(item) =>
            changed(
              `Uploaded “${item.filename}”. Process text, then index for search when ready.`,
            )
          }
          onClose={close}
        />
      )}
      {dialog?.type === 'preview' && (
        <PreviewDialog document={dialog.item} onClose={close} />
      )}
    </AppShell>
  )
}
