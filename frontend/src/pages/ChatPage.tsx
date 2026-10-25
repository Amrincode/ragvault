import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { PreviewDialog } from '../features/documents/LibraryDialogs'
import {
  askDocuments,
  getDocument,
  listCollections,
  listSearchDocuments,
} from '../lib/api'
import type { ChatResponse, ChatSource } from '../types/chat'
import type { Collection, Document, DocumentPage } from '../types/library'

export function ChatPage() {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  const [collection, setCollection] = useState('')
  const [document, setDocument] = useState('')
  const [collections, setCollections] = useState<Collection[]>([])
  const [documents, setDocuments] = useState<DocumentPage | null>(null)
  const [offset, setOffset] = useState(0)
  const [topK, setTopK] = useState(5)
  const [loadingFilters, setLoadingFilters] = useState(true)
  const [filterError, setFilterError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ChatResponse | null>(null)
  const [preview, setPreview] = useState<{
    document: Document
    page: number
  } | null>(null)
  const active = useRef<AbortController | null>(null)
  const previewRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      listCollections(controller.signal),
      listSearchDocuments(collection || null, offset, controller.signal),
    ])
      .then(([nextCollections, nextDocuments]) => {
        if (!controller.signal.aborted) {
          setCollections(nextCollections)
          setDocuments(nextDocuments)
          setFilterError(null)
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setFilterError(
            cause instanceof Error ? cause.message : 'Unable to load filters',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFilters(false)
      })
    return () => controller.abort()
  }, [collection, offset])
  useEffect(
    () => () => {
      active.current?.abort()
      previewRequest.current?.abort()
    },
    [],
  )

  async function ask() {
    if (busy || !question.trim()) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError(null)
    setResult(null)
    setAsked(question.trim())
    try {
      const next = await askDocuments(
        {
          question: question.trim(),
          collection_id: collection || null,
          document_id: document || null,
          top_k: topK,
        },
        controller.signal,
      )
      if (!controller.signal.aborted) setResult(next)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Document chat failed',
        )
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  async function openSource(source: ChatSource) {
    previewRequest.current?.abort()
    const controller = new AbortController()
    previewRequest.current = controller
    try {
      const original = await getDocument(source.document_id, controller.signal)
      if (!controller.signal.aborted)
        setPreview({ document: original, page: source.page_number })
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Original PDF unavailable',
        )
    }
  }

  return (
    <AppShell page="Document chat">
      <p className="eyebrow">ASK YOUR INDEXED DOCUMENTS</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
        Document chat
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Ask a question and Gemma will use retrieved PDF passages to draft an
        answer. Answers can be wrong. Review the supporting text and original
        pages.
      </p>
      <p className="mt-3 text-xs leading-5 text-muted">
        First upload, process and index PDFs in{' '}
        <Link className="font-semibold text-forest underline" to="/documents">
          Documents
        </Link>
        . Each question stands alone. Chat is not saved and earlier answers are
        not sent to the model.
      </p>
      <form
        className="mt-7 space-y-5 rounded-2xl border border-line bg-white p-6"
        onSubmit={(event) => {
          event.preventDefault()
          void ask()
        }}
      >
        <div className="flex flex-wrap gap-4">
          <label className="min-w-40 flex-1 text-xs font-medium">
            Collection
            <select
              aria-label="Collection filter"
              className="mt-2 block w-full rounded-lg border border-line p-2"
              value={collection}
              disabled={busy || loadingFilters}
              onChange={(event) => {
                setCollection(event.target.value)
                setDocument('')
                setOffset(0)
                setDocuments(null)
                setResult(null)
                setLoadingFilters(true)
              }}
            >
              <option value="">All collections</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-40 flex-1 text-xs font-medium">
            Document
            <select
              aria-label="Document filter"
              className="mt-2 block w-full rounded-lg border border-line p-2"
              value={document}
              disabled={busy || loadingFilters}
              onChange={(event) => {
                setDocument(event.target.value)
                setResult(null)
              }}
            >
              <option value="">All documents</option>
              {documents?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium">
            Passages to retrieve
            <input
              aria-label="Passages to retrieve"
              className="mt-2 block w-24 rounded-lg border border-line p-2"
              type="number"
              min={1}
              max={20}
              step={1}
              value={topK}
              disabled={busy}
              onChange={(event) => {
                setTopK(Number(event.target.value))
                setResult(null)
              }}
            />
          </label>
        </div>
        {documents && documents.total > 100 && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <button
              type="button"
              className="secondary-button"
              disabled={busy || loadingFilters || offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - 100))
                setDocument('')
                setResult(null)
                setLoadingFilters(true)
              }}
            >
              Previous document options
            </button>
            <span>
              {offset + 1}–{Math.min(offset + 100, documents.total)} of{' '}
              {documents.total} documents
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={
                busy || loadingFilters || offset + 100 >= documents.total
              }
              onClick={() => {
                setOffset(offset + 100)
                setDocument('')
                setResult(null)
                setLoadingFilters(true)
              }}
            >
              Next document options
            </button>
          </div>
        )}
        <label htmlFor="chat-question" className="block text-sm font-medium">
          Your question
        </label>
        <textarea
          id="chat-question"
          rows={3}
          maxLength={2000}
          className="w-full rounded-xl border border-line p-3 text-sm"
          placeholder="What does the document say about backup retention?"
          value={question}
          disabled={busy}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          type="submit"
          className="primary-button"
          disabled={busy || loadingFilters || !!filterError || !question.trim()}
        >
          {busy ? 'Preparing answer…' : 'Ask documents'}
        </button>
      </form>
      {(error || filterError) && (
        <p role="alert" className="error-message mt-5">
          {error || filterError}
        </p>
      )}
      {busy && (
        <p role="status" className="mt-6 text-sm text-muted">
          Retrieving evidence, then generating a local answer… The model may
          take a few minutes to load.
        </p>
      )}
      {result && (
        <section aria-label="Document answer" className="mt-7 space-y-5">
          <div className="rounded-2xl border border-line bg-white p-6">
            <p className="eyebrow">
              {result.status === 'answered'
                ? 'ANSWER FROM RETRIEVED TEXT'
                : 'INSUFFICIENT EVIDENCE'}
            </p>
            <h2 className="mt-3 break-words text-base font-semibold">
              {asked}
            </h2>
            {/* Plain text intentionally: no HTML/Markdown parser or model-controlled links. */}
            <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">
              {result.answer}
            </p>
            <p className="mt-5 text-xs leading-5 text-muted">
              {result.chat_model} · Retrieval{' '}
              {result.timings.retrieval_ms.toFixed(0)} ms · Generation{' '}
              {result.timings.generation_ms.toFixed(0)} ms ·{' '}
              {result.context_count} of {result.retrieval_count} retrieved
              passages used as context
            </p>
          </div>
          {result.incompatible_documents > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              {result.incompatible_documents} indexed documents were excluded
              because their embedding settings differ. Reindex them in
              Documents.
            </p>
          )}
          {!!result.sources.length && (
            <div>
              <h2 className="text-base font-semibold">Retrieved sources</h2>
              <p className="mt-2 text-xs leading-5 text-muted">
                These excerpts were sent to the model. They do not verify every
                statement in the answer.
              </p>
              <ol className="mt-4 space-y-4">
                {result.sources.map((source) => (
                  <li
                    key={source.source_id}
                    className="rounded-xl border border-line bg-white p-5"
                  >
                    <h3 className="break-words text-sm font-semibold">
                      {source.filename} · Page {source.page_number}
                    </h3>
                    <p className="mt-2 break-all font-mono text-[10px] text-muted">
                      {source.source_id}
                    </p>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                      {source.excerpt}
                    </p>
                    <button
                      type="button"
                      className="secondary-button mt-4"
                      aria-label={`Open ${source.filename} at page ${source.page_number}`}
                      onClick={() => void openSource(source)}
                    >
                      Open original · Page {source.page_number}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}
      {preview && (
        <PreviewDialog
          key={`${preview.document.id}:${preview.page}`}
          document={preview.document}
          initialPage={preview.page}
          onClose={() => setPreview(null)}
        />
      )}
    </AppShell>
  )
}
