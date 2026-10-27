import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { PreviewDialog } from '../features/documents/LibraryDialogs'
import { ClaimAnswer } from '../features/chat/ClaimAnswer'
import { ChatComposer } from '../features/chat/ChatComposer'
import { Icon } from '../components/Icon'
import {
  askDocuments,
  getDocument,
  listCollections,
  listSearchDocuments,
} from '../lib/api'
import type { ChatResponse, ChatSource } from '../types/chat'
import type { Collection, Document, DocumentPage } from '../types/library'

export function SingleQuestionChat() {
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

  function clearResult() {
    previewRequest.current?.abort()
    setPreview(null)
    setResult(null)
  }
  async function ask() {
    if (busy || !question.trim()) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError(null)
    clearResult()
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
    <AppShell page="Document chat" compact>
      <Link to="/chat" className="text-sm text-forest underline">
        Open saved conversations
      </Link>
      <div className="mt-4 mb-6">
        <p className="eyebrow">UNSAVED WORKSPACE</p>
        <h1 className="mt-1 text-page font-semibold">Ask a single question</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          A focused answer from your indexed PDFs. Questions stand alone,
          nothing is saved, and earlier answers are not sent to the model.
          Review the supporting wording and original pages.
        </p>
        <p className="mt-2 text-meta text-muted">
          Upload, process and index your PDFs in{' '}
          <Link className="font-medium text-accent underline" to="/documents">
            Documents
          </Link>{' '}
          before asking.
        </p>
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <div className="space-y-4 p-4 sm:p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="documents" />
            Choose your evidence
          </h2>
          <div className="flex flex-wrap gap-4">
            <label className="min-w-0 basis-48 flex-1 text-sm font-medium">
              Collection
              <select
                aria-label="Collection filter"
                className="text-input mt-2 min-w-0"
                value={collection}
                disabled={busy || loadingFilters}
                onChange={(event) => {
                  setCollection(event.target.value)
                  setDocument('')
                  setOffset(0)
                  setDocuments(null)
                  clearResult()
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
            <label className="min-w-0 basis-48 flex-1 text-sm font-medium">
              Document
              <select
                aria-label="Document filter"
                className="text-input mt-2 min-w-0"
                value={document}
                disabled={busy || loadingFilters}
                onChange={(event) => {
                  setDocument(event.target.value)
                  clearResult()
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
                  clearResult()
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
                  clearResult()
                  setLoadingFilters(true)
                }}
              >
                Next document options
              </button>
            </div>
          )}
        </div>
        <ChatComposer
          single
          question={question}
          onQuestion={setQuestion}
          topK={topK}
          onTopK={(value) => {
            setTopK(value)
            clearResult()
          }}
          disabled={busy || loadingFilters || !!filterError}
          busy={busy}
          onSend={() => void ask()}
        />
      </div>
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
        <section aria-label="Document answer" className="mt-6 space-y-4">
          <div className="rounded-card border border-line bg-surface p-4 sm:p-6">
            <p className="eyebrow">
              {result.status === 'answered'
                ? 'ANSWER FROM RETRIEVED TEXT'
                : result.status === 'partial'
                  ? 'PARTIAL ANSWER'
                  : result.status === 'unreliable'
                    ? 'ANSWER WITHHELD'
                    : 'INSUFFICIENT EVIDENCE'}
            </p>
            <h2 className="mt-3 break-words text-base font-semibold">
              {asked}
            </h2>
            <div className="mt-4">
              <ClaimAnswer
                result={result}
                onOpenSource={(source) => void openSource(source)}
                compact
              />
            </div>
            <p className="mt-5 text-xs leading-5 text-muted">
              {result.chat_model} · Retrieval{' '}
              {result.timings.retrieval_ms.toFixed(0)} ms · Generation{' '}
              {result.timings.generation_ms.toFixed(0)} ms · Source checks{' '}
              {(result.timings.verification_ms ?? 0).toFixed(0)} ms ·{' '}
              {result.context_count} of {result.retrieval_count} retrieved
              passages used as context
            </p>
          </div>
          {result.incompatible_documents > 0 && (
            <p className="rounded-lg bg-warning-soft p-3 text-xs text-warning">
              {result.incompatible_documents} indexed documents were excluded
              because their embedding settings differ. Reindex them in
              Documents.
            </p>
          )}
          {!!result.sources.length && (
            <details
              open={!result.claims?.length || undefined}
              className="rounded-card border border-line bg-surface p-4 sm:p-6"
            >
              <summary className="cursor-pointer text-sm font-medium">
                Retrieved sources · context sent to the model
              </summary>
              <p className="mt-2 text-xs leading-5 text-muted">
                These excerpts were sent to the model. They do not verify every
                statement in the answer.
              </p>
              <ol className="mt-4 space-y-4">
                {result.sources.map((source) => (
                  <li
                    key={source.source_id}
                    className="rounded-xl border border-line bg-surface p-5"
                  >
                    <h3 className="break-words text-sm font-semibold">
                      {source.citation_id
                        ? `[${source.citation_id.slice(1)}] `
                        : ''}
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
                      aria-label={`Open original · Page ${source.page_number}: ${source.filename}`}
                      onClick={() => void openSource(source)}
                    >
                      Open original · Page {source.page_number}
                    </button>
                  </li>
                ))}
              </ol>
            </details>
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
