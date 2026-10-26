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
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'
import { LoadingIndicator } from '../../components/ui/LoadingIndicator'
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
        <FormField
          label={label}
          error={error ?? undefined}
          hint={
            filename
              ? 'Keep the .pdf extension. Original file contents stay unchanged.'
              : undefined
          }
        >
          <Input
            autoFocus
            id={id}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
            maxLength={filename ? 255 : 120}
            className="text-input mt-2"
            disabled={busy}
          />
        </FormField>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <Button type="submit" loading={busy} disabled={!value.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
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
  onUploaded: (document: Document) => void
  onClose: () => void
}) {
  const [collectionId, setCollectionId] = useState(
    selectedId ?? collections[0]?.id ?? '',
  )
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    if (!file || !collectionId || busy) return
    setBusy(true)
    setError(null)
    try {
      const uploaded = await uploadDocument(collectionId, file)
      onUploaded(uploaded)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="Upload a PDF" busy={busy} onClose={onClose}>
      <p className="mb-5 text-sm leading-6 text-muted">
        Add one original PDF to your local library. You can process and index it
        separately after uploading.
      </p>
      <form
        aria-busy={busy}
        onSubmit={(event) => {
          void submit(event)
        }}
        className="space-y-5"
      >
        <FormField
          label="Collection"
          hint="The PDF will be stored in this collection."
        >
          <select
            className="text-input"
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
        </FormField>
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
          className={`min-w-0 rounded-card border border-dashed p-4 ${dragging ? 'border-primary bg-accent-soft' : 'border-control-border bg-canvas'}`}
        >
          <Icon name="upload" className="mb-3 size-7 text-accent" />
          <FormField
            label="Choose PDF"
            hint={`One unencrypted PDF · Up to ${formatBytes(config.max_upload_bytes)} · ${config.max_pdf_pages.toLocaleString()} pages. Drop a file here or use the file chooser.`}
            error={error ?? undefined}
          >
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={busy}
              onChange={(event) => choose(event.target.files)}
              className="block w-full min-w-0 rounded-control text-meta file:mr-3 file:min-h-10 file:rounded-control file:border file:border-control-border file:bg-surface file:px-3 file:py-2 file:font-medium file:text-ink"
            />
          </FormField>
        </div>
        {file && (
          <div
            className="min-w-0 rounded-control border border-line bg-accent-soft p-4"
            role="status"
          >
            <p className="text-meta font-medium text-accent">Selected PDF</p>
            <p className="mt-1 break-words text-sm font-semibold [overflow-wrap:anywhere]">
              {file.name}
            </p>
            <p className="mt-1 text-meta text-muted">
              {formatBytes(file.size)} · Destination:{' '}
              {collections.find((item) => item.id === collectionId)?.name}
            </p>
          </div>
        )}
        {busy && (
          <LoadingIndicator label="Uploading and validating your PDF…" />
        )}
        <p className="text-meta leading-6 text-muted">
          Files remain on this machine. Duplicate content in the same collection
          is rejected. The server validates the original PDF; no text extraction
          or AI runs during upload.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={!file || !collectionId}
          >
            {busy ? 'Uploading…' : 'Upload PDF'}
          </Button>
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
