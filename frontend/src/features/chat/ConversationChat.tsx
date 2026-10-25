import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router'
import { AppShell } from '../../components/AppShell'
import { Dialog } from '../../components/Dialog'
import { NameDialog, PreviewDialog } from '../documents/LibraryDialogs'
import { ClaimAnswer } from './ClaimAnswer'
import * as api from '../../lib/api'
import type { ChatSource } from '../../types/chat'
import type { Collection, Document, DocumentPage } from '../../types/library'
import type {
  Conversation,
  ConversationPage,
  MessagePage,
  SavedMessage,
  TurnInput,
} from '../../types/conversations'

const explain = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : 'Request failed; refresh before retrying'

function mergeMessages(previous: SavedMessage[], incoming: SavedMessage[]) {
  const rows = new Map(previous.map((message) => [message.id, message]))
  incoming.forEach((message) => rows.set(message.id, message))
  return [...rows.values()].sort((a, b) => a.position - b.position)
}

export function ConversationChat() {
  const [params] = useSearchParams()
  return <ConversationWorkspace key={params.get('conversation') || 'new'} />
}

function ConversationWorkspace() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('conversation') || ''
  const selectedRef = useRef(selected)
  const [list, setList] = useState<ConversationPage | null>(null)
  const [listOffset, setListOffset] = useState(0)
  const [listError, setListError] = useState<string | null>(null)
  const [current, setCurrent] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<SavedMessage[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(!!selected)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [topK, setTopK] = useState(5)
  const [title, setTitle] = useState('New conversation')
  const [collection, setCollection] = useState('')
  const [document, setDocument] = useState('')
  const [collections, setCollections] = useState<Collection[]>([])
  const [documents, setDocuments] = useState<DocumentPage | null>(null)
  const [docOffset, setDocOffset] = useState(0)
  const [scopeError, setScopeError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [preview, setPreview] = useState<{
    document: Document
    page: number
  } | null>(null)
  const active = useRef<AbortController | null>(null)
  const previewRequest = useRef<AbortController | null>(null)
  const pending = useRef<{ conversation: string; body: TurnInput } | null>(null)
  const [unknownSubmission, setUnknownSubmission] = useState(false)
  const [submission, setSubmission] = useState<TurnInput | null>(null)
  const historyPane = useRef<HTMLOListElement | null>(null)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const followLatest = useRef(true)
  const prepend = useRef<{ height: number; top: number } | null>(null)
  const [showJump, setShowJump] = useState(false)
  const focusAfterSend = useRef(false)

  // Only follow new content while the reader remains near the latest message.
  useLayoutEffect(() => {
    const pane = historyPane.current
    if (!pane) return
    if (prepend.current) {
      pane.scrollTop =
        prepend.current.top + pane.scrollHeight - prepend.current.height
      prepend.current = null
    } else if (followLatest.current) pane.scrollTop = pane.scrollHeight
  }, [messages, submission, current?.id, loading])
  useLayoutEffect(() => {
    if (!busy && !current?.generating && focusAfterSend.current) {
      if (followLatest.current) composer.current?.focus()
      focusAfterSend.current = false
    }
  }, [busy, current?.generating])

  function jumpToLatest() {
    followLatest.current = true
    setShowJump(false)
    if (historyPane.current)
      historyPane.current.scrollTop = historyPane.current.scrollHeight
  }

  const reloadList = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await api.listConversations(listOffset, signal)
        if (!signal?.aborted) {
          setList(next)
          setListError(null)
        }
      } catch (cause) {
        if (!signal?.aborted) setListError(explain(cause))
      }
    },
    [listOffset],
  )
  useEffect(() => {
    const c = new AbortController()
    void Promise.resolve().then(() => reloadList(c.signal))
    return () => c.abort()
  }, [reloadList])
  useEffect(() => {
    const c = new AbortController()
    Promise.all([
      api.listCollections(c.signal),
      api.listSearchDocuments(collection || null, docOffset, c.signal),
    ])
      .then(([groups, docs]) => {
        if (!c.signal.aborted) {
          setCollections(groups)
          setDocuments(docs)
          setScopeError(null)
        }
      })
      .catch((cause) => {
        if (!c.signal.aborted) setScopeError(explain(cause))
      })
    return () => c.abort()
  }, [collection, docOffset])
  const refresh = useCallback(async (id: string, signal?: AbortSignal) => {
    const [conversation, page] = await Promise.all([
      api.getConversation(id, signal),
      api.getConversationMessages(id, 0, signal),
    ])
    if (!signal?.aborted && selectedRef.current === id) {
      setCurrent(conversation)
      setMessages((old) => mergeMessages(old, page.items))
      setTotal(page.total)
      setError(null)
    }
  }, [])
  useEffect(() => {
    if (!selected) return
    const c = new AbortController()
    Promise.resolve()
      .then(() => refresh(selected, c.signal))
      .catch((cause) => {
        if (!c.signal.aborted) setError(explain(cause))
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false)
      })
    return () => c.abort()
  }, [selected, refresh])
  const pendingMessages = messages.some(
    (message) => message.status === 'pending',
  )
  useEffect(() => {
    if (!selected || !(busy || current?.generating || pendingMessages)) return
    const c = new AbortController()
    const timer = setInterval(() => {
      void refresh(selected, c.signal).catch((cause) => {
        if (!c.signal.aborted) setError(explain(cause))
      })
    }, 5000)
    return () => {
      clearInterval(timer)
      c.abort()
    }
  }, [selected, busy, current?.generating, pendingMessages, refresh])
  useEffect(
    () => () => {
      active.current?.abort()
      previewRequest.current?.abort()
    },
    [],
  )

  function choose(id: string) {
    setParams(id ? { conversation: id } : {})
  }
  async function create() {
    setBusy(true)
    setError(null)
    try {
      const item = await api.createConversation({
        title: title.trim(),
        collection_id: collection || null,
        document_id: document || null,
      })
      choose(item.id)
      setListOffset(0)
      await reloadList()
    } catch (cause) {
      setError(explain(cause))
    } finally {
      setBusy(false)
    }
  }
  async function send(check = false) {
    if (!selected || busy) return
    const id = selected
    const body =
      check && pending.current?.conversation === id
        ? pending.current.body
        : {
            request_id: crypto.randomUUID(),
            question: question.trim(),
            top_k: topK,
          }
    if (!body.question) return
    pending.current = { conversation: id, body }
    jumpToLatest()
    setSubmission(body)
    setQuestion('')
    const c = new AbortController()
    active.current = c
    setBusy(true)
    setError(null)
    try {
      const turn = await api.askConversation(id, body, c.signal)
      if (!c.signal.aborted && selectedRef.current === id) {
        setMessages((old) =>
          [
            ...old.filter((m) => m.request_id !== body.request_id),
            turn.user,
            turn.assistant,
          ].sort((a, b) => a.position - b.position),
        )
        setSubmission(null)
        focusAfterSend.current = true
        setUnknownSubmission(false)
        pending.current = null
        await refresh(id, c.signal)
        await reloadList(c.signal)
      }
    } catch (cause) {
      if (!c.signal.aborted && selectedRef.current === id) {
        setError(explain(cause))
        setUnknownSubmission(true)
      }
    } finally {
      if (!c.signal.aborted && selectedRef.current === id) setBusy(false)
    }
  }
  async function older() {
    if (!selected || loading) return
    const id = selected
    setLoading(true)
    try {
      const page: MessagePage = await api.getConversationMessages(
        id,
        messages.length,
      )
      if (selectedRef.current === id) {
        if (historyPane.current) {
          prepend.current = {
            height: historyPane.current.scrollHeight,
            top: historyPane.current.scrollTop,
          }
          followLatest.current = false
          setShowJump(true)
        }
        setMessages((old) => mergeMessages(old, page.items))
        setTotal(page.total)
      }
    } catch (cause) {
      if (selectedRef.current === id) setError(explain(cause))
    } finally {
      if (selectedRef.current === id) setLoading(false)
    }
  }
  async function openSource(source: ChatSource) {
    previewRequest.current?.abort()
    const c = new AbortController()
    previewRequest.current = c
    try {
      const doc = await api.getDocument(source.document_id, c.signal)
      if (!c.signal.aborted)
        setPreview({ document: doc, page: source.page_number })
    } catch (cause) {
      if (!c.signal.aborted) setError(explain(cause))
    }
  }
  async function destroy() {
    if (!current) return
    setBusy(true)
    try {
      await api.deleteConversation(current.id)
      setDeleting(false)
      choose('')
      await reloadList()
    } catch (cause) {
      setError(explain(cause))
      setDeleting(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell page="Document chat" compact>
      <h1 className="text-2xl font-semibold">Document chat</h1>
      <p className="mt-1 text-sm text-muted">
        Saved locally · answers use fresh PDF evidence.
      </p>
      <Link
        className="mt-2 inline-block text-xs text-forest underline"
        to="/chat?mode=single"
      >
        Single question · without saving
      </Link>
      <div className="mt-4 grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside
          aria-label="Conversations"
          className="rounded-xl border border-line bg-surface p-4"
        >
          <button
            type="button"
            className="primary-button w-full"
            onClick={() => choose('')}
          >
            New conversation
          </button>
          {listError && (
            <p role="alert" className="error-message">
              {listError}{' '}
              <button onClick={() => void reloadList()}>
                Retry conversation list
              </button>
            </p>
          )}
          {!list && !listError && <p role="status">Loading conversations…</p>}
          {list?.total === 0 && (
            <p className="mt-4 text-sm text-muted">No conversations yet.</p>
          )}
          <ul className="mt-4 max-h-40 space-y-2 overflow-auto lg:max-h-[45vh]">
            {list?.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={selected === item.id}
                  onClick={() => choose(item.id)}
                  className="w-full break-words rounded-lg border border-line p-3 text-left text-sm aria-pressed:bg-mint/20"
                >
                  {item.title}
                  <span className="mt-1 block text-xs text-muted">
                    {item.generating
                      ? 'Generating…'
                      : new Date(item.updated_at).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {list && list.total > 20 && (
            <div className="mt-4 flex justify-between text-sm">
              <button
                disabled={listOffset === 0}
                onClick={() => setListOffset(Math.max(0, listOffset - 20))}
              >
                Previous conversations
              </button>
              <button
                disabled={listOffset + 20 >= list.total}
                onClick={() => setListOffset(listOffset + 20)}
              >
                Next conversations
              </button>
            </div>
          )}
        </aside>
        <section
          className={`min-w-0 rounded-xl border border-line bg-surface p-4 ${selected ? 'flex h-[75dvh] min-h-[26rem] flex-col lg:h-[calc(100dvh-14rem)]' : ''}`}
          aria-label="Current conversation"
        >
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          {!selected ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void create()
              }}
              className="space-y-4"
            >
              <h2 className="text-lg font-semibold">
                Start a saved conversation
              </h2>
              <label className="block text-sm">
                Conversation title
                <input
                  className="text-input mt-1"
                  value={title}
                  maxLength={120}
                  required
                  disabled={busy}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="block text-sm">
                Collection scope
                <select
                  aria-label="Collection scope"
                  className="text-input mt-1"
                  value={collection}
                  disabled={busy}
                  onChange={(event) => {
                    setCollection(event.target.value)
                    setDocuments(null)
                    setDocument('')
                    setDocOffset(0)
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
              <label className="block text-sm">
                Document scope
                <select
                  aria-label="Document scope"
                  className="text-input mt-1"
                  value={document}
                  disabled={busy || !documents}
                  onChange={(event) => setDocument(event.target.value)}
                >
                  <option value="">All documents</option>
                  {documents?.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.filename}
                    </option>
                  ))}
                </select>
              </label>
              {documents && documents.total > 100 && (
                <div className="flex gap-4 text-sm">
                  <button
                    type="button"
                    disabled={!docOffset}
                    onClick={() => {
                      setDocOffset(Math.max(0, docOffset - 100))
                      setDocuments(null)
                      setDocument('')
                    }}
                  >
                    Previous scope documents
                  </button>
                  <button
                    type="button"
                    disabled={docOffset + 100 >= documents.total}
                    onClick={() => {
                      setDocOffset(docOffset + 100)
                      setDocuments(null)
                      setDocument('')
                    }}
                  >
                    More scope documents
                  </button>
                </div>
              )}
              {scopeError && (
                <p role="alert" className="error-message">
                  {scopeError}
                </p>
              )}
              <p className="text-xs text-muted">
                Scope is fixed after creation. If a scoped document is deleted,
                this discussion stays readable but cannot retrieve from a
                broader scope.
              </p>
              <button
                className="primary-button"
                disabled={busy || !documents || !!scopeError || !title.trim()}
              >
                {busy ? 'Creating…' : 'Create conversation'}
              </button>
            </form>
          ) : (
            <>
              {loading && !current && (
                <p role="status">Loading saved messages…</p>
              )}
              {error && !current && (
                <button
                  onClick={() =>
                    void refresh(selected).catch((cause) =>
                      setError(explain(cause)),
                    )
                  }
                >
                  Retry loading conversation
                </button>
              )}
              {current && (
                <>
                  <h2 className="break-words text-lg font-semibold">
                    {current.title}
                  </h2>
                  <p className="mt-2 break-words text-xs text-muted">
                    {current.scope_label}
                  </p>
                  {!current.scope_available && (
                    <p role="status" className="error-message">
                      Original scope unavailable. Create a new conversation to
                      select different documents.
                    </p>
                  )}
                  <div className="my-2 flex flex-wrap gap-4 text-xs">
                    <button
                      disabled={busy || current.generating}
                      onClick={() => setEditing(true)}
                    >
                      Rename conversation
                    </button>
                    <button
                      disabled={busy || current.generating}
                      onClick={() => setDeleting(true)}
                    >
                      Delete conversation
                    </button>
                    <button
                      onClick={() =>
                        void refresh(selected).catch((cause) =>
                          setError(explain(cause)),
                        )
                      }
                    >
                      Refresh messages
                    </button>
                  </div>
                  {messages.length < total && (
                    <button
                      disabled={loading}
                      onClick={() => void older()}
                      className="mb-3 text-sm underline"
                    >
                      Load older messages
                    </button>
                  )}
                  <ol
                    ref={historyPane}
                    aria-label="Conversation messages"
                    tabIndex={0}
                    onScroll={(event) => {
                      const pane = event.currentTarget
                      const nearLatest =
                        pane.scrollHeight - pane.clientHeight - pane.scrollTop <
                        64
                      followLatest.current = nearLatest
                      setShowJump(!nearLatest)
                    }}
                    className="min-h-0 flex-1 space-y-4 overflow-auto overscroll-contain rounded-lg border border-line bg-canvas p-3 [overflow-anchor:none]"
                  >
                    {messages.length === 0 && !submission && (
                      <li className="text-sm text-muted">
                        No messages yet. Ask about your selected PDFs.
                      </li>
                    )}
                    {messages.map((message) => (
                      <li
                        key={message.id}
                        className={`rounded-xl p-4 ${message.role === 'user' ? 'ml-6 bg-mint/20' : 'mr-3 bg-surface'}`}
                      >
                        <p className="text-xs font-semibold">
                          {message.role === 'user' ? 'You' : 'Assistant'} ·{' '}
                          {new Date(message.created_at).toLocaleString()}
                        </p>
                        {message.status === 'pending' ? (
                          <p role="status" className="mt-2 text-sm">
                            Thinking · finding evidence in your PDFs…
                          </p>
                        ) : message.answer ? (
                          <>
                            {message.citation_state !== 'none' && (
                              <details className="mt-2 text-xs text-muted">
                                <summary className="cursor-pointer">
                                  Saved source details ·{' '}
                                  {message.citation_state}
                                </summary>
                                <p>
                                  Historical source availability:{' '}
                                  {message.citation_state}. Stored checks are
                                  not a new factual verification.
                                </p>
                              </details>
                            )}
                            <ClaimAnswer
                              result={message.answer}
                              onOpenSource={(source) => void openSource(source)}
                              allowSources={
                                message.citation_state === 'available'
                              }
                              compact
                            />
                          </>
                        ) : (
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                            {message.content}
                          </p>
                        )}
                        {message.citation_state === 'invalid' &&
                          !message.answer && (
                            <p className="text-xs text-muted">
                              Saved citation data is invalid; no citation links
                              are available.
                            </p>
                          )}
                        {message.status === 'failed' && (
                          <button
                            className="mt-3 text-sm underline"
                            disabled={busy || current.generating}
                            onClick={() => {
                              setQuestion(
                                messages.find(
                                  (m) =>
                                    m.request_id === message.request_id &&
                                    m.role === 'user',
                                )?.content || '',
                              )
                              pending.current = null
                              setUnknownSubmission(false)
                            }}
                          >
                            Retry question as a new turn
                          </button>
                        )}
                      </li>
                    ))}
                    {submission &&
                      !messages.some(
                        (m) =>
                          m.request_id === submission.request_id &&
                          m.role === 'user',
                      ) && (
                        <li className="ml-6 rounded-xl bg-mint/20 p-4">
                          <p className="text-xs font-semibold">
                            You · submitting
                          </p>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                            {submission.question}
                          </p>
                        </li>
                      )}
                    {submission &&
                      !messages.some(
                        (m) =>
                          m.request_id === submission.request_id &&
                          m.role === 'assistant',
                      ) && (
                        <li
                          className="mr-3 rounded-xl bg-surface p-4"
                          role="status"
                        >
                          <p className="text-xs font-semibold">Assistant</p>
                          <p className="mt-2 text-sm">
                            {unknownSubmission && !busy
                              ? 'Submission status unknown. Check submission below to recover this turn.'
                              : 'Thinking · finding evidence in your PDFs…'}
                          </p>
                        </li>
                      )}
                  </ol>
                  {showJump && (
                    <button
                      type="button"
                      className="mx-auto mt-2 rounded-full border border-line px-4 py-1 text-xs text-forest"
                      onClick={jumpToLatest}
                    >
                      Jump to latest
                    </button>
                  )}
                  <form
                    className="mt-3 shrink-0 space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void send()
                    }}
                  >
                    <label className="block text-sm">
                      Your question
                      <textarea
                        ref={composer}
                        className="text-input mt-1"
                        value={question}
                        maxLength={2000}
                        rows={2}
                        disabled={
                          busy ||
                          current.generating ||
                          !current.scope_available ||
                          unknownSubmission
                        }
                        onChange={(event) => setQuestion(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault()
                            if (
                              !current.generating &&
                              current.scope_available &&
                              !unknownSubmission
                            )
                              void send()
                          }
                        }}
                      />
                    </label>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="block text-xs">
                        Passages to retrieve
                        <input
                          type="number"
                          className="text-input ml-3 max-w-20"
                          min={1}
                          max={20}
                          value={topK}
                          disabled={busy || current.generating}
                          onChange={(event) =>
                            setTopK(Number(event.target.value))
                          }
                        />
                      </label>
                      {unknownSubmission ? (
                        <button
                          type="button"
                          className="primary-button"
                          disabled={busy}
                          onClick={() => void send(true)}
                        >
                          Check submission · reuse request key
                        </button>
                      ) : (
                        <button
                          className="primary-button"
                          disabled={
                            busy ||
                            current.generating ||
                            !current.scope_available ||
                            !question.trim()
                          }
                        >
                          {busy ? 'Saving and generating…' : 'Send question'}
                        </button>
                      )}
                    </div>
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer">
                        Enter to send · Shift+Enter for newline · retry details
                      </summary>
                      <p className="mt-1">
                        Failed turns stay visible. Retry creates a new turn;
                        uncertain submissions reuse their request key.
                        Interrupted requests become retryable after the server's
                        generation timeout.
                      </p>
                    </details>
                  </form>
                </>
              )}
            </>
          )}
        </section>
      </div>
      {editing && current && (
        <NameDialog
          title="Rename conversation"
          label="Conversation title"
          initialValue={current.title}
          onClose={() => setEditing(false)}
          onSave={async (value) => {
            const item = await api.renameConversation(current.id, value)
            setCurrent(item)
            await reloadList()
          }}
        />
      )}
      {deleting && current && (
        <Dialog
          title="Delete conversation?"
          busy={busy}
          onClose={() => setDeleting(false)}
        >
          <p className="text-sm">
            Delete “{current.title}” and all saved messages permanently?
            Original PDFs and collections stay in the library.
          </p>
          <div className="mt-5 flex justify-end gap-4">
            <button disabled={busy} onClick={() => setDeleting(false)}>
              Cancel
            </button>
            <button
              disabled={busy}
              className="primary-button"
              onClick={() => void destroy()}
            >
              Confirm deletion
            </button>
          </div>
        </Dialog>
      )}
      {preview && (
        <PreviewDialog
          document={preview.document}
          initialPage={preview.page}
          onClose={() => setPreview(null)}
        />
      )}
    </AppShell>
  )
}
