import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { PreviewDialog } from '../features/documents/LibraryDialogs'
import {
  getDocument,
  listCollections,
  listSearchDocuments,
  searchPassages,
} from '../lib/api'
import type { Collection, Document, DocumentPage } from '../types/library'
import type { SearchHit, SearchResponse } from '../types/search'

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [collections, setCollections] = useState<Collection[]>([])
  const [collection, setCollection] = useState('')
  const [document, setDocument] = useState('')
  const [documents, setDocuments] = useState<DocumentPage | null>(null)
  const [offset, setOffset] = useState(0)
  const [topK, setTopK] = useState(5)
  const [busy, setBusy] = useState(false)
  const [loadingFilters, setLoadingFilters] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [preview, setPreview] = useState<{
    document: Document
    page: number
  } | null>(null)
  const active = useRef<AbortController | null>(null)
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
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load search filters',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFilters(false)
      })
    return () => controller.abort()
  }, [collection, offset])
  useEffect(() => () => active.current?.abort(), [])
  async function search() {
    if (!query.trim()) {
      setError('Enter a search question')
      return
    }
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const next = await searchPassages(
        {
          query: query.trim(),
          top_k: topK,
          collection_id: collection || null,
          document_id: document || null,
        },
        controller.signal,
      )
      if (!controller.signal.aborted) setResult(next)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Search failed')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  async function openOriginal(hit: SearchHit) {
    try {
      setPreview({
        document: await getDocument(hit.document_id),
        page: hit.page_number,
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Original PDF unavailable',
      )
    }
  }
  return (
    <AppShell page="Semantic search">
      <p className="eyebrow">PASSAGES FROM YOUR DOCUMENTS</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
        Semantic search
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Find indexed passages using natural-language questions. Results are
        original excerpts with page references; no answer is generated.
      </p>
      <p className="mt-4 text-xs leading-5 text-muted">
        Upload → Process text → Index for search → Search. Manage indexing in{' '}
        <Link className="font-semibold text-forest underline" to="/documents">
          Documents
        </Link>
        . Everything runs locally.
      </p>
      <form
        className="mt-7 space-y-5 rounded-2xl border border-line bg-white p-6"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <label className="block text-sm font-medium" htmlFor="search-query">
          Search question
        </label>
        <textarea
          id="search-query"
          className="w-full rounded-xl border border-line p-3 text-sm"
          rows={3}
          maxLength={2000}
          placeholder="How does the document describe data backups?"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={busy}
        />
        <div className="flex flex-wrap gap-4">
          <label className="min-w-40 flex-1 text-xs font-medium">
            Collection
            <select
              className="mt-2 block w-full rounded-lg border border-line p-2"
              aria-label="Collection filter"
              value={collection}
              disabled={busy || loadingFilters}
              onChange={(event) => {
                setCollection(event.target.value)
                setDocument('')
                setOffset(0)
                setDocuments(null)
                setLoadingFilters(true)
                setResult(null)
              }}
            >
              <option value="">All collections</option>
              {collections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-40 flex-1 text-xs font-medium">
            Document
            <select
              className="mt-2 block w-full rounded-lg border border-line p-2"
              aria-label="Document filter"
              value={document}
              disabled={busy || loadingFilters}
              onChange={(event) => {
                setDocument(event.target.value)
                setResult(null)
              }}
            >
              <option value="">All documents</option>
              {documents?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium">
            Results
            <input
              aria-label="Maximum results"
              type="number"
              min={1}
              max={20}
              className="mt-2 block w-20 rounded-lg border border-line p-2"
              value={topK}
              disabled={busy}
              onChange={(event) => setTopK(Number(event.target.value))}
            />
          </label>
        </div>
        {documents && documents.total > 100 && (
          <div className="flex items-center gap-3 text-xs text-muted">
            <button
              className="secondary-button"
              type="button"
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
              className="secondary-button"
              type="button"
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
        <button
          className="primary-button"
          type="submit"
          disabled={busy || !query.trim() || loadingFilters}
        >
          {busy ? 'Searching…' : 'Search passages'}
        </button>
      </form>
      {error && (
        <p role="alert" className="error-message mt-5">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="mt-6 text-sm text-muted">
          Embedding your question and searching indexed passages…
        </p>
      )}
      {result && (
        <section className="mt-7" aria-label="Search results">
          <p className="mb-4 text-xs text-muted">
            {result.items.length} passages · {result.elapsed_ms.toFixed(0)} ms ·{' '}
            {result.model}
          </p>
          {result.incompatible_documents > 0 && (
            <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              {result.incompatible_documents} indexed documents use a different
              embedding model or settings and were excluded. Reindex them in
              Documents.
            </p>
          )}
          {!result.items.length ? (
            <div className="rounded-xl border border-dashed border-line bg-white p-8 text-sm text-muted">
              No matching indexed passages. Process and index documents, check
              the filters, or try another question.
            </div>
          ) : (
            <ol className="space-y-4">
              {result.items.map((hit) => (
                <li
                  key={hit.chunk_id}
                  className="rounded-xl border border-line bg-white p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="break-words text-sm font-semibold">
                        {hit.filename}
                      </h2>
                      <p className="mt-1 text-xs text-muted">
                        Page {hit.page_number} ·{' '}
                        {collections.find((c) => c.id === hit.collection_id)
                          ?.name ?? 'Collection'}
                      </p>
                    </div>
                    <span className="text-xs text-muted">
                      Cosine similarity {hit.similarity.toFixed(3)}
                    </span>
                  </div>
                  <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6">
                    {hit.excerpt}
                  </p>
                  <button
                    className="secondary-button mt-4"
                    type="button"
                    onClick={() => void openOriginal(hit)}
                    aria-label={`Open ${hit.filename} at page ${hit.page_number}`}
                  >
                    Open original · Page {hit.page_number}
                  </button>
                </li>
              ))}
            </ol>
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
