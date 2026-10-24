import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import {
  DeleteDialog,
  NameDialog,
  PreviewDialog,
  UploadDialog,
} from '../features/documents/LibraryDialogs'
import { formatBytes } from '../lib/format'
import { useLibrary } from '../hooks/useLibrary'
import {
  createCollection,
  deleteCollection,
  deleteDocument,
  documentDownloadUrl,
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
  const { collections, documents, config, loading, error, reload } = useLibrary(
    selected,
    offset,
  )
  const selectedCollection = collections.find((item) => item.id === selected)
  const total = collections.reduce((sum, item) => sum + item.document_count, 0)
  function selectCollection(id: string | null) {
    setSelected(id)
    setOffset(0)
  }
  function changed() {
    setOffset(0)
    reload()
  }
  const close = () => setDialog(null)

  return (
    <AppShell page="Documents">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">YOUR KNOWLEDGE, ORGANIZED</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Document library
          </h1>
          <p className="mt-3 text-sm text-muted">
            Collect your PDFs. Keep the originals close.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setDialog({ type: 'create' })}
          >
            <Icon name="plus" className="size-4" />
            New collection
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!collections.length || !config || loading}
            onClick={() => setDialog({ type: 'upload' })}
          >
            <Icon name="upload" className="size-4" />
            Upload PDF
          </button>
        </div>
      </div>
      <div className="mt-6 rounded-lg border border-line bg-white px-4 py-3 text-xs leading-5 text-muted">
        <span className="font-medium text-forest">Local library</span> · Single
        user · PDFs stay on this machine · No AI processing
      </div>
      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside
          aria-label="Collections"
          className="rounded-xl border border-line bg-white p-3"
        >
          <h2 className="px-2 py-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Collections
          </h2>
          <button
            type="button"
            onClick={() => selectCollection(null)}
            aria-pressed={selected === null}
            className={`collection-button ${selected === null ? 'bg-forest text-white' : 'hover:bg-canvas'}`}
          >
            <span>All documents</span>
            <span>{total}</span>
          </button>
          {collections.map((item) => (
            <div key={item.id} className="mt-1">
              <button
                type="button"
                onClick={() => selectCollection(item.id)}
                aria-pressed={selected === item.id}
                className={`collection-button ${selected === item.id ? 'bg-forest text-white' : 'hover:bg-canvas'}`}
              >
                <span className="truncate">{item.name}</span>
                <span>{item.document_count}</span>
              </button>
              {selected === item.id && (
                <div className="flex gap-3 px-3 pb-2 pt-2 text-[11px] text-muted">
                  <button
                    type="button"
                    className="hover:text-forest"
                    aria-label={`Rename collection ${item.name}`}
                    onClick={() =>
                      setDialog({ type: 'renameCollection', item })
                    }
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="hover:text-red-700"
                    aria-label={`Delete collection ${item.name}`}
                    onClick={() =>
                      setDialog({ type: 'deleteCollection', item })
                    }
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
          {!loading && !collections.length && (
            <p className="px-2 py-4 text-xs leading-5 text-muted">
              Create a collection to start uploading PDFs.
            </p>
          )}
        </aside>
        <section className="min-w-0" aria-labelledby="documents-heading">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 id="documents-heading" className="font-semibold">
                {selectedCollection?.name ?? 'All documents'}
              </h2>
              <p className="mt-1 text-xs text-muted">
                {documents.total}{' '}
                {documents.total === 1 ? 'document' : 'documents'}
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={loading}
              onClick={reload}
            >
              <Icon
                name="refresh"
                className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              Refresh library
            </button>
          </div>
          {error && (
            <div role="alert" className="error-message mb-4">
              {error}{' '}
              <button type="button" className="ml-2 underline" onClick={reload}>
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <div
              role="status"
              className="rounded-xl border border-line bg-white py-16 text-center text-sm text-muted"
            >
              Loading your library…
            </div>
          ) : !documents.items.length ? (
            <div className="rounded-xl border border-dashed border-line bg-white px-6 py-16 text-center">
              <Icon
                name="documents"
                className="mx-auto size-10 text-forest/50"
              />
              <h3 className="mt-5 text-lg font-medium">
                Room for your first PDF.
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
                {collections.length
                  ? 'Upload a PDF to keep it organized, preview the original, and find it here later.'
                  : 'Start with a collection, then add the PDFs you want to keep together.'}
              </p>
              <button
                type="button"
                className="primary-button mx-auto mt-6"
                onClick={() =>
                  setDialog({ type: collections.length ? 'upload' : 'create' })
                }
              >
                {collections.length
                  ? 'Upload your first PDF'
                  : 'Create your first collection'}
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-white">
              <ul className="divide-y divide-line">
                {documents.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-start gap-4 p-5"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-canvas text-forest">
                      <Icon name="documents" className="size-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="max-w-full break-words text-left text-sm font-semibold hover:underline"
                        onClick={() => setDialog({ type: 'preview', item })}
                        aria-label={`Preview ${item.filename}`}
                      >
                        {item.filename}
                      </button>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                        <span>
                          {collections.find(
                            (collection) =>
                              collection.id === item.collection_id,
                          )?.name ?? 'Collection'}
                        </span>
                        <span>{formatBytes(item.file_size)}</span>
                        <span>
                          {new Date(item.created_at).toLocaleDateString()}
                        </span>
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-800">
                          Uploaded
                        </span>
                      </div>
                      <p
                        className="mt-2 font-mono text-[9px] text-muted"
                        title={item.checksum}
                      >
                        SHA-256 {item.checksum.slice(0, 12)}…
                      </p>
                    </div>
                    <div className="flex w-full flex-wrap gap-3 pl-15 text-xs sm:w-auto sm:pl-0">
                      <button
                        type="button"
                        className="text-forest hover:underline"
                        aria-label={`Rename ${item.filename}`}
                        onClick={() =>
                          setDialog({ type: 'renameDocument', item })
                        }
                      >
                        Rename
                      </button>
                      <a
                        className="text-forest hover:underline"
                        href={documentDownloadUrl(item.id)}
                        aria-label={`Download ${item.filename}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        className="text-red-700 hover:underline"
                        aria-label={`Delete ${item.filename}`}
                        onClick={() =>
                          setDialog({ type: 'deleteDocument', item })
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {documents.total > 20 && (
            <div className="mt-4 flex items-center justify-between text-xs text-muted">
              <button
                type="button"
                className="secondary-button"
                disabled={offset === 0 || loading}
                onClick={() => setOffset((value) => Math.max(0, value - 20))}
              >
                Previous
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 20, documents.total)} of{' '}
                {documents.total}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={offset + 20 >= documents.total || loading}
                onClick={() => setOffset((value) => value + 20)}
              >
                Next
              </button>
            </div>
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
            changed()
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
            changed()
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
            selectCollection(null)
            changed()
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
            changed()
          }}
        />
      )}
      {dialog?.type === 'deleteDocument' && (
        <DeleteDialog
          title="Delete document?"
          description={`Permanently delete “${dialog.item.filename}” and its stored PDF? This cannot be undone.`}
          onClose={close}
          onConfirm={async () => {
            await deleteDocument(dialog.item.id)
            changed()
          }}
        />
      )}
      {dialog?.type === 'upload' && config && (
        <UploadDialog
          collections={collections}
          selectedId={selected}
          config={config}
          onUploaded={changed}
          onClose={close}
        />
      )}
      {dialog?.type === 'preview' && (
        <PreviewDialog document={dialog.item} onClose={close} />
      )}
    </AppShell>
  )
}
