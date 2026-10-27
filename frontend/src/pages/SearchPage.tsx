import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { FormField } from '../components/ui/FormField'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingIndicator } from '../components/ui/LoadingIndicator'
import { PreviewDialog } from '../features/documents/LibraryDialogs'
import {
  getDocument,
  listCollections,
  listSearchDocuments,
  searchPassages,
} from '../lib/api'
import type { Collection, Document, DocumentPage } from '../types/library'
import type { SearchHit, SearchResponse } from '../types/search'

const explain = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [collections, setCollections] = useState<Collection[]>([])
  const [collection, setCollection] = useState('')
  const [document, setDocument] = useState('')
  const [documents, setDocuments] = useState<DocumentPage | null>(null)
  const [offset, setOffset] = useState(0)
  const [topK, setTopK] = useState(5)
  const [busy, setBusy] = useState(false)
  const [loadingFilters, setLoadingFilters] = useState(true)
  const [filterError, setFilterError] = useState<string | null>(null)
  const [filterAttempt, setFilterAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [preview, setPreview] = useState<{
    document: Document
    page: number
  } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
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
          setFilterError(explain(cause, 'Unable to load search filters'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFilters(false)
      })
    return () => controller.abort()
  }, [collection, offset, filterAttempt])
  useEffect(
    () => () => {
      active.current?.abort()
      previewRequest.current?.abort()
    },
    [],
  )

  function clearResults() {
    previewRequest.current?.abort()
    setPreview(null)
    setOpening(null)
    setResult(null)
    setError(null)
  }
  async function search() {
    if (busy || loadingFilters || filterError || !documents || !query.trim())
      return
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    clearResults()
    setBusy(true)
    setSubmittedQuery(query.trim())
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
      if (!controller.signal.aborted) setError(explain(cause, 'Search failed'))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  async function openOriginal(hit: SearchHit) {
    if (opening === hit.chunk_id) return
    previewRequest.current?.abort()
    const controller = new AbortController()
    previewRequest.current = controller
    setOpening(hit.chunk_id)
    setError(null)
    try {
      const original = await getDocument(hit.document_id, controller.signal)
      if (!controller.signal.aborted)
        setPreview({ document: original, page: hit.page_number })
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(explain(cause, 'Original PDF unavailable'))
    } finally {
      if (!controller.signal.aborted) setOpening(null)
    }
  }
  function pageOptions(next: number) {
    setOffset(next)
    setDocument('')
    setDocuments(null)
    setLoadingFilters(true)
    setFilterError(null)
    clearResults()
  }

  return (
    <AppShell page="Semantic search">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="eyebrow">DISCOVER YOUR EVIDENCE</p>
          <h1 className="mt-1 text-page font-semibold">Semantic search</h1>
          <p className="mt-3 text-body leading-7 text-muted">
            Find ideas in your indexed PDFs using a natural-language question.
            Results are original excerpts with page references; no answer is
            generated.
          </p>
        </div>
        <Link className="secondary-button" to="/documents">
          <Icon name="documents" />
          Open document library
        </Link>
      </div>
      <form
        className="rounded-card border border-line bg-surface p-4 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <label htmlFor="search-query" className="form-label mb-2">
          Search question
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Icon
              name="search"
              className="pointer-events-none absolute top-3 left-3 text-muted"
            />
            <Input
              id="search-query"
              type="search"
              maxLength={2000}
              required
              className="min-h-11 pl-10!"
              placeholder="Find a specific idea in your indexed PDFs…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={busy}
            />
          </div>
          <Button
            type="submit"
            size="lg"
            loading={busy}
            disabled={
              !query.trim() || loadingFilters || !!filterError || !documents
            }
          >
            {busy ? 'Searching…' : 'Search passages'}
          </Button>
        </div>
        <div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]">
          <FormField label="Collection">
            <select
              className="text-input min-w-0"
              aria-label="Collection filter"
              value={collection}
              disabled={busy || loadingFilters}
              onChange={(event) => {
                setCollection(event.target.value)
                setDocument('')
                setOffset(0)
                setDocuments(null)
                setLoadingFilters(true)
                setFilterError(null)
                clearResults()
              }}
            >
              <option value="">All collections</option>
              {collections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Document">
            <select
              className="text-input min-w-0"
              aria-label="Document filter"
              value={document}
              disabled={busy || loadingFilters || !documents}
              onChange={(event) => {
                setDocument(event.target.value)
                clearResults()
              }}
            >
              <option value="">All documents</option>
              {documents?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Results">
            <Input
              aria-label="Maximum results"
              type="number"
              min={1}
              max={20}
              step={1}
              required
              value={topK}
              disabled={busy}
              onChange={(event) => setTopK(Number(event.target.value))}
            />
          </FormField>
        </div>
        {documents && documents.total > 100 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-meta text-muted">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || loadingFilters || offset === 0}
              onClick={() => pageOptions(Math.max(0, offset - 100))}
            >
              Previous document options
            </Button>
            <span>
              {offset + 1}–{Math.min(offset + 100, documents.total)} of{' '}
              {documents.total} documents
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={
                busy || loadingFilters || offset + 100 >= documents.total
              }
              onClick={() => pageOptions(offset + 100)}
            >
              Next document options
            </Button>
          </div>
        )}
        <p className="mt-4 text-meta leading-6 text-muted">
          Search uses indexed passages only. Upload, process text and index for
          search in{' '}
          <Link className="font-medium text-accent underline" to="/documents">
            Documents
          </Link>
          . Everything runs locally.
        </p>
      </form>
      {filterError && (
        <div role="alert" className="error-message mt-4">
          {filterError}
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 ml-2"
            onClick={() => {
              setLoadingFilters(true)
              setFilterError(null)
              setFilterAttempt((value) => value + 1)
            }}
          >
            Retry search filters
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="error-message mt-4">
          {error}
        </p>
      )}
      {busy ? (
        <div className="mt-6 rounded-card border border-line bg-surface p-6">
          <LoadingIndicator label="Embedding your question and searching indexed passages…" />
        </div>
      ) : loadingFilters ? (
        <div className="mt-5">
          <LoadingIndicator label="Loading search filters…" />
        </div>
      ) : !result && !error && !filterError ? (
        <div className="mt-6">
          <EmptyState
            icon={<Icon name="search" className="size-7" />}
            title="Find the passage behind an idea"
            description="Ask a focused question, narrow the document scope if needed, then open an original page to read its context."
          />
        </div>
      ) : null}
      {result && (
        <section className="mt-7 min-w-0 space-y-4" aria-label="Search results">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-section font-semibold [overflow-wrap:anywhere]">
                Results for “{submittedQuery}”
              </h2>
              <p role="status" className="mt-1 text-meta text-muted">
                {result.items.length}{' '}
                {result.items.length === 1 ? 'passage' : 'passages'} ·{' '}
                {result.elapsed_ms.toFixed(0)} ms
              </p>
            </div>
            <details className="max-w-full text-meta text-muted">
              <summary className="min-h-9 cursor-pointer py-1">
                Search details
              </summary>
              <p className="mt-1 break-words">
                {result.model} · {result.dimensions} dimensions · up to{' '}
                {result.top_k} results
              </p>
            </details>
          </div>
          <p className="text-meta leading-6 text-muted">
            Cosine similarity measures embedding similarity, not factual
            confidence or answer correctness. Read the original page to assess
            the evidence.
          </p>
          {result.incompatible_documents > 0 && (
            <p className="rounded-control border border-warning-border bg-warning-soft p-3 text-sm text-warning">
              {result.incompatible_documents} indexed documents use a different
              embedding model or settings and were excluded. Reindex them in
              Documents.
            </p>
          )}
          {!result.items.length ? (
            <EmptyState
              title="No matching indexed passages"
              description="Process and index documents, check the filters, or try another question."
            />
          ) : (
            <ol className="space-y-4">
              {result.items.map((hit, index) => (
                <li
                  key={hit.chunk_id}
                  className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-6"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-control bg-accent-soft text-sm font-semibold text-accent"
                      aria-label={`Result ${index + 1}`}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <h3 className="break-words text-base font-semibold [overflow-wrap:anywhere]">
                        {hit.filename}
                      </h3>
                      <p className="mt-1 break-words text-meta text-muted">
                        Page {hit.page_number}
                        {collections.find(
                          (item) => item.id === hit.collection_id,
                        )?.name
                          ? ` · ${collections.find((item) => item.id === hit.collection_id)!.name}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <blockquote className="mt-4 whitespace-pre-wrap break-words border-l-2 border-line pl-4 text-body leading-7 [overflow-wrap:anywhere]">
                    {hit.excerpt}
                  </blockquote>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <Button
                      variant="secondary"
                      aria-busy={opening === hit.chunk_id || undefined}
                      onClick={() => void openOriginal(hit)}
                      aria-label={`Open ${hit.filename} at page ${hit.page_number}`}
                    >
                      <Icon name="arrow" className="size-4" />
                      {opening === hit.chunk_id
                        ? 'Opening original…'
                        : `Open original · Page ${hit.page_number}`}
                    </Button>
                    <Badge>Cosine similarity {hit.similarity.toFixed(3)}</Badge>
                  </div>
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
          onClose={() => {
            previewRequest.current?.abort()
            setPreview(null)
          }}
        />
      )}
    </AppShell>
  )
}
