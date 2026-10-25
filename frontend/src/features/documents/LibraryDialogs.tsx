import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useState,
  type FormEvent,
} from 'react'
import { Dialog } from '../../components/Dialog'
import { Icon } from '../../components/Icon'
import {
  documentDownloadUrl,
  getDocumentPDF,
  uploadDocument,
} from '../../lib/api'
import type { Collection, Document, LibraryConfig } from '../../types/library'
import { formatBytes } from '../../lib/format'

const PdfPreview = lazy(() => import('./PdfPreview'))

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : 'Something went wrong; please retry'
}

export function NameDialog({
  title,
  label,
  initialValue = '',
  filename = false,
  onSave,
  onClose,
}: {
  title: string
  label: string
  initialValue?: string
  filename?: boolean
  onSave: (name: string) => Promise<unknown>
  onClose: () => void
}) {
  const id = useId()
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSave(value.trim())
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={title} onClose={onClose} busy={busy}>
      <form
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <input
          autoFocus
          id={id}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
          maxLength={filename ? 255 : 120}
          className="text-input mt-2"
          disabled={busy}
        />
        {filename && (
          <p className="mt-2 text-xs text-muted">
            Keep the .pdf extension. The original file contents stay unchanged.
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary-button" disabled={busy || !value.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function DeleteDialog({
  title,
  description,
  onConfirm,
  onClose,
}: {
  title: string
  description: string
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={title} onClose={onClose} busy={busy}>
      <p className="break-words text-sm leading-6 text-muted">{description}</p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-lg bg-danger-action px-4 py-2 text-sm font-medium text-on-danger hover:bg-danger-hover disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            void confirm()
          }}
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Dialog>
  )
}

export function UploadDialog({
  collections,
  selectedId,
  config,
  onUploaded,
  onClose,
}: {
  collections: Collection[]
  selectedId: string | null
  config: LibraryConfig
  onUploaded: () => void
  onClose: () => void
}) {
  const [collectionId, setCollectionId] = useState(
    selectedId ?? collections[0]?.id ?? '',
  )
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  function choose(files: FileList | null) {
    setError(null)
    setFile(null)
    if (!files?.length) return
    if (files.length !== 1) {
      setError('Choose one PDF at a time')
      return
    }
    if (!files[0].name.toLowerCase().endsWith('.pdf')) {
      setError('Choose a PDF file')
      return
    }
    if (files[0].size > config.max_upload_bytes) {
      setError(`PDF exceeds the ${formatBytes(config.max_upload_bytes)} limit`)
      return
    }
    setFile(files[0])
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || !collectionId) return
    setBusy(true)
    setError(null)
    try {
      await uploadDocument(collectionId, file)
      onUploaded()
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="Upload a PDF" busy={busy} onClose={onClose}>
      <form
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <label htmlFor={`${id}-collection`} className="text-sm font-medium">
          Collection
        </label>
        <select
          id={`${id}-collection`}
          className="text-input mt-2"
          value={collectionId}
          onChange={(event) => setCollectionId(event.target.value)}
          disabled={busy}
          required
        >
          {collections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <div
          onDragOver={(event) => {
            event.preventDefault()
            if (!busy) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            if (!busy) choose(event.dataTransfer.files)
          }}
          className={`mt-5 rounded-xl border-2 border-dashed p-6 text-center ${dragging ? 'border-forest bg-success-soft' : 'border-line bg-canvas'}`}
        >
          <Icon name="upload" className="mx-auto mb-3 size-7 text-forest" />
          <label htmlFor={`${id}-file`} className="block text-sm font-medium">
            Drop a PDF here or choose a file
          </label>
          <input
            id={`${id}-file`}
            aria-label="Choose PDF"
            type="file"
            accept=".pdf,application/pdf"
            disabled={busy}
            onChange={(event) => choose(event.target.files)}
            className="mt-4 w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-2 file:font-medium file:text-forest"
          />
          <p className="mt-3 text-xs text-muted">
            Up to {formatBytes(config.max_upload_bytes)} ·{' '}
            {config.max_pdf_pages.toLocaleString()} pages · Unencrypted PDFs
          </p>
        </div>
        {file && (
          <p className="mt-3 break-words text-sm">
            {file.name}{' '}
            <span className="text-muted">({formatBytes(file.size)})</span>
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {busy && (
          <p
            role="status"
            className="mt-4 flex items-center gap-2 text-sm text-forest"
          >
            <Icon name="refresh" className="size-4 animate-spin" />
            Uploading and validating your PDF…
          </p>
        )}
        <p className="mt-4 text-xs leading-5 text-muted">
          PDFs are stored on your machine. Duplicate content in the same
          collection is rejected. No text extraction or AI processing runs.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || !file || !collectionId}
          >
            {busy ? 'Uploading…' : 'Upload PDF'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function PreviewDialog({
  document,
  onClose,
  initialPage = 1,
}: {
  document: Document
  onClose: () => void
  initialPage?: number
}) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void getDocumentPDF(document.id, controller.signal)
      .then((blob) => {
        if (!controller.signal.aborted) {
          setBlob(blob)
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause))
      })
    return () => {
      controller.abort()
    }
  }, [document.id])
  return (
    <Dialog title={document.filename} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>Original PDF · {formatBytes(document.file_size)}</span>
        <a
          href={documentDownloadUrl(document.id)}
          className="secondary-button"
          target="_blank"
          rel="noreferrer"
        >
          Download original
        </a>
      </div>
      {error ? (
        <p role="alert" className="error-message">
          {error}
        </p>
      ) : blob ? (
        <Suspense fallback={<p role="status">Loading PDF renderer…</p>}>
          <PdfPreview
            blob={blob}
            filename={document.filename}
            initialPage={initialPage}
          />
        </Suspense>
      ) : (
        <p role="status" className="py-16 text-center text-sm text-muted">
          Loading PDF preview…
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        PDF.js renders one page at a time. Download the original for printing,
        text selection, or interactive PDF features.
      </p>
    </Dialog>
  )
}
