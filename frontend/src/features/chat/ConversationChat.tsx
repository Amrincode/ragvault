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
import { ChatMessage } from './ChatMessage'
import { ChatComposer } from './ChatComposer'
import { ConversationHistory } from './ConversationHistory'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'
import { LoadingIndicator } from '../../components/ui/LoadingIndicator'
import { Icon } from '../../components/Icon'
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
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  return (
    <ConversationWorkspace
      key={params.get('conversation') || 'new'}
      initialDraft={drafts[params.get('conversation') || ''] || ''}
      onDraftChange={(id, value) =>
        setDrafts((old) => ({ ...old, [id]: value }))
      }
    />
  )
}

function ConversationWorkspace({
  initialDraft,
  onDraftChange,
}: {
  initialDraft: string
  onDraftChange: (id: string, value: string) => void
}) {
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
  const [question, setQuestionValue] = useState(initialDraft)
  function setQuestion(value: string) {
    onDraftChange(selected, value)
    setQuestionValue(value)
  }
  const [historyOpen, setHistoryOpen] = useState(false)
  const conversationHeading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    conversationHeading.current?.focus()
  }, [current?.id])
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
    setHistoryOpen(false)
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
    if (
      !selected ||
      busy ||
      (!check && (current?.generating || !current?.scope_available))
    )
      return
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

  const history = (
    <ConversationHistory
      list={list}
      error={listError}
      selected={selected}
      offset={listOffset}
      choose={choose}
      retry={() => void reloadList()}
      paginate={setListOffset}
    />
  )
  return (
    <AppShell page="Document chat" compact>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">DOCUMENT WORKSPACE</p>
          <h1 className="mt-1 text-page font-semibold">Document chat</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            className="lg:hidden"
            aria-haspopup="dialog"
            aria-label="Conversation history"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(true)}
          >
            <Icon name="chat" />
            <span aria-hidden="true" className="sm:hidden">
              History
            </span>
            <span aria-hidden="true" className="hidden sm:inline">
              Conversation history
            </span>
          </Button>
          <Link
            className="min-h-10 rounded-control px-2 py-2 text-sm font-medium text-accent underline underline-offset-4"
            to="/chat?mode=single"
            aria-label="Single question - without saving"
          >
            <span className="sm:hidden">Single question</span>
            <span className="hidden sm:inline">
              Single question · without saving
            </span>
          </Link>
        </div>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[13.5rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside
          aria-label="Conversations"
          className="hidden h-[calc(100dvh-12rem)] min-h-96 rounded-card border border-line bg-surface p-4 lg:block"
        >
          {history}
        </aside>
        <section
          className={`min-w-0 overflow-hidden rounded-card border border-line bg-surface ${selected ? 'flex h-[calc(100dvh-16rem)] min-h-[30rem] flex-col lg:h-[calc(100dvh-12rem)]' : ''}`}
          aria-label="Current conversation"
        >
          {error && (
            <p role="alert" className="error-message m-3">
              {error}
            </p>
          )}
          {!selected ? (
            <div className="mx-auto max-w-xl px-5 py-8 sm:p-8">
              <span className="mb-5 inline-grid size-12 place-items-center rounded-card border border-line bg-accent-soft text-accent">
                <Icon name="chat" className="size-6" />
              </span>
              <h2
                ref={conversationHeading}
                tabIndex={-1}
                className="text-section font-semibold"
              >
                Start a saved conversation
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Give your discussion a name and choose which indexed PDFs it can
                use. Ask focused questions and follow up with fresh document
                evidence.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!busy && documents && !scopeError && title.trim())
                    void create()
                }}
                className="mt-6 space-y-5"
              >
                <FormField label="Conversation title">
                  <Input
                    value={title}
                    maxLength={120}
                    required
                    disabled={busy}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </FormField>
                <FormField label="Collection scope">
                  <select
                    className="text-input min-w-0"
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
                </FormField>
                <FormField label="Document scope">
                  <select
                    className="text-input min-w-0"
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
                </FormField>
                {documents && documents.total > 100 && (
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!docOffset}
                      onClick={() => {
                        setDocOffset(Math.max(0, docOffset - 100))
                        setDocuments(null)
                        setDocument('')
                      }}
                    >
                      Previous scope documents
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={docOffset + 100 >= documents.total}
                      onClick={() => {
                        setDocOffset(docOffset + 100)
                        setDocuments(null)
                        setDocument('')
                      }}
                    >
                      More scope documents
                    </Button>
                  </div>
                )}
                {scopeError && (
                  <p role="alert" className="error-message">
                    {scopeError}
                  </p>
                )}
                {!documents && !scopeError && (
                  <LoadingIndicator label="Loading document scopes…" />
                )}
                <div className="rounded-control border border-line bg-canvas p-4 text-sm leading-6 text-muted">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    <Icon name="lock" className="size-4" />
                    Scope is fixed after creation
                  </p>
                  <p className="mt-1">
                    If a scoped document is deleted, this discussion stays
                    readable but cannot retrieve from a broader scope.
                  </p>
                </div>
                <Button
                  type="submit"
                  loading={busy}
                  disabled={!documents || !!scopeError || !title.trim()}
                >
                  {busy ? 'Creating…' : 'Create conversation'}
                </Button>
              </form>
            </div>
          ) : (
            <>
              {loading && !current && (
                <div className="p-6">
                  <LoadingIndicator label="Loading saved messages…" />
                </div>
              )}
              {error && !current && (
                <Button
                  variant="secondary"
                  className="m-4 self-start"
                  onClick={() =>
                    void refresh(selected).catch((cause) =>
                      setError(explain(cause)),
                    )
                  }
                >
                  Retry loading conversation
                </Button>
              )}
              {current && (
                <>
                  <div className="shrink-0 border-b border-line p-4 sm:px-6">
                    <h2
                      ref={conversationHeading}
                      tabIndex={-1}
                      className="line-clamp-2 break-words text-section font-semibold [overflow-wrap:anywhere]"
                      title={current.title}
                    >
                      {current.title}
                    </h2>
                    <details className="mt-1 text-meta text-muted">
                      <summary
                        className="cursor-pointer"
                        aria-label={`Evidence scope: ${current.scope_label}`}
                      >
                        <span className="inline-block max-w-[calc(100%-1.5rem)] truncate align-bottom">
                          {current.scope_label}
                        </span>
                      </summary>
                      <div className="mt-2 space-y-1 break-words rounded-control border border-line bg-canvas p-3 [overflow-wrap:anywhere]">
                        <p>Full title: {current.title}</p>
                        <p>Selected evidence: {current.scope_label}</p>
                        <p>
                          Scope is fixed. Each new turn retrieves evidence only
                          within this scope.
                        </p>
                      </div>
                    </details>
                    {!current.scope_available && (
                      <p role="status" className="error-message">
                        Original scope unavailable. Create a new conversation to
                        select different documents.
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || current.generating}
                        aria-label="Rename conversation"
                        onClick={() => setEditing(true)}
                      >
                        <span aria-hidden="true" className="sm:hidden">
                          Rename
                        </span>
                        <span aria-hidden="true" className="hidden sm:inline">
                          Rename conversation
                        </span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || current.generating}
                        aria-label="Delete conversation"
                        onClick={() => setDeleting(true)}
                      >
                        <span aria-hidden="true" className="sm:hidden">
                          Delete
                        </span>
                        <span aria-hidden="true" className="hidden sm:inline">
                          Delete conversation
                        </span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Refresh messages"
                        onClick={() =>
                          void refresh(selected).catch((cause) =>
                            setError(explain(cause)),
                          )
                        }
                      >
                        <span aria-hidden="true" className="sm:hidden">
                          Refresh
                        </span>
                        <span aria-hidden="true" className="hidden sm:inline">
                          Refresh messages
                        </span>
                      </Button>
                    </div>
                    {messages.length < total && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={loading}
                        onClick={() => void older()}
                      >
                        {loading
                          ? 'Loading older messages…'
                          : 'Load older messages'}
                      </Button>
                    )}
                  </div>
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
                    className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-6 [overflow-anchor:none] [overflow-wrap:anywhere] sm:px-6 lg:px-8"
                  >
                    {messages.length === 0 && !submission && (
                      <li className="mx-auto max-w-sm py-8 text-center">
                        <Icon
                          name="documents"
                          className="mx-auto mb-3 size-8 text-accent"
                        />
                        <p className="font-medium">
                          Your documents, in conversation
                        </p>
                        <p className="mt-2 text-sm leading-6 text-muted">
                          No messages yet. Ask about your selected PDFs. Review
                          the cited original pages alongside each answer.
                        </p>
                      </li>
                    )}
                    {messages.map((message) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        disabled={busy || current.generating}
                        openSource={(source) => void openSource(source)}
                        retry={() => {
                          setQuestion(
                            messages.find(
                              (m) =>
                                m.request_id === message.request_id &&
                                m.role === 'user',
                            )?.content || '',
                          )
                          pending.current = null
                          setUnknownSubmission(false)
                          composer.current?.focus()
                        }}
                      />
                    ))}
                    {submission &&
                      !messages.some(
                        (m) =>
                          m.request_id === submission.request_id &&
                          m.role === 'user',
                      ) && (
                        <li className="ml-auto w-fit max-w-[92%] rounded-card border border-line bg-accent-soft p-4">
                          <p className="text-meta font-semibold">
                            You · submitting
                          </p>
                          <p className="mt-2 whitespace-pre-wrap break-words text-body leading-7">
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
                        <li className="py-2" role="status">
                          <p className="text-meta font-semibold">Assistant</p>
                          <p className="mt-2 text-sm leading-6 text-muted">
                            {unknownSubmission && !busy
                              ? 'Submission status unknown. Check submission below to recover this turn.'
                              : 'Thinking · finding evidence in your PDFs… Searching documents and generating a response; replies appear when complete.'}
                          </p>
                        </li>
                      )}
                  </ol>
                  {showJump && (
                    <div className="flex justify-center border-t border-line py-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={jumpToLatest}
                      >
                        Jump to latest
                      </Button>
                    </div>
                  )}
                  <ChatComposer
                    question={question}
                    onQuestion={setQuestion}
                    topK={topK}
                    onTopK={setTopK}
                    inputRef={composer}
                    busy={busy}
                    disabled={
                      busy ||
                      current.generating ||
                      !current.scope_available ||
                      unknownSubmission
                    }
                    onSend={() => void send()}
                    recovery={
                      unknownSubmission ? () => void send(true) : undefined
                    }
                  />
                </>
              )}
            </>
          )}
        </section>
      </div>
      {historyOpen && (
        <Dialog
          title="Conversation history"
          onClose={() => setHistoryOpen(false)}
        >
          <div className="h-[min(65dvh,36rem)]">{history}</div>
        </Dialog>
      )}
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
              className="button"
              data-variant="danger"
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
