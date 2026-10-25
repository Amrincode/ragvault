import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../lib/api'
import type {
  Conversation,
  SavedMessage,
  SavedTurn,
} from '../../types/conversations'
import type { ChatResponse, CheckedCitation } from '../../types/chat'
import { ConversationChat } from './ConversationChat'

vi.mock('../../lib/api', () => ({
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  askConversation: vi.fn(),
  listCollections: vi.fn(),
  listSearchDocuments: vi.fn(),
  getDocument: vi.fn(),
}))
vi.mock('../documents/LibraryDialogs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../documents/LibraryDialogs')>()),
  PreviewDialog: ({ initialPage }: { initialPage: number }) => (
    <div role="dialog">PDF page {initialPage}</div>
  ),
}))
const timestamp = '2026-10-25T00:00:00Z'
const first: Conversation = {
  id: 'one',
  title: 'Safety discussion',
  collection_id: 'group',
  document_id: 'doc',
  scope_label: 'Document: safety.pdf',
  scope_available: true,
  generating: false,
  created_at: timestamp,
  updated_at: timestamp,
}
const second: Conversation = {
  ...first,
  id: 'two',
  title: 'Finance discussion',
}
const user: SavedMessage = {
  id: 'u',
  request_id: 'r',
  position: 1,
  role: 'user',
  status: 'complete',
  content: 'What are the safety rules?',
  answer: null,
  error_code: null,
  citation_state: 'none',
  created_at: timestamp,
}
const assistant: SavedMessage = {
  ...user,
  id: 'a',
  position: 2,
  role: 'assistant',
  content: 'Teams must wear helmets.',
}
const citation: CheckedCitation = {
  source_id: 'S-c',
  citation_id: 'C1',
  number: 1,
  chunk_id: 'c',
  document_id: 'doc',
  collection_id: 'group',
  filename: 'safety.pdf',
  page_number: 2,
  excerpt: 'Teams must wear helmets.',
  match_method: 'exact',
}
const answer: ChatResponse = {
  status: 'answered',
  answer: assistant.content,
  sources: [citation],
  claims: [
    {
      text: assistant.content,
      status: 'potentially_supported',
      issues: [],
      citations: [citation],
    },
  ],
  chat_model: 'gemma3:4b',
  embedding_model: 'nomic-embed-text',
  retrieval_count: 1,
  context_count: 1,
  incompatible_documents: 0,
  timings: { retrieval_ms: 1, generation_ms: 1, total_ms: 2 },
}
let transcript: SavedMessage[]

beforeEach(() => {
  vi.resetAllMocks()
  transcript = [user, assistant]
  vi.mocked(api.listConversations).mockResolvedValue({
    items: [first, second],
    total: 2,
    limit: 20,
    offset: 0,
  })
  vi.mocked(api.getConversation).mockImplementation(async (id) =>
    id === 'one' ? first : second,
  )
  vi.mocked(api.getConversationMessages).mockImplementation(async () => ({
    items: transcript,
    total: transcript.length,
    limit: 20,
    offset: 0,
  }))
  vi.mocked(api.listCollections).mockResolvedValue([
    {
      id: 'group',
      name: 'Policies',
      document_count: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
  ])
  vi.mocked(api.listSearchDocuments).mockResolvedValue({
    items: [
      {
        id: 'doc',
        collection_id: 'group',
        filename: 'safety.pdf',
        processing_status: 'processed',
        file_size: 100,
        mime_type: 'application/pdf',
        checksum: 'a'.repeat(64),
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    total: 1,
    limit: 100,
    offset: 0,
  })
  vi.mocked(api.createConversation).mockResolvedValue(first)
  vi.mocked(api.renameConversation).mockImplementation(async (_id, title) => ({
    ...first,
    title,
  }))
  vi.mocked(api.deleteConversation).mockResolvedValue(undefined)
  vi.mocked(api.askConversation).mockImplementation(async (_id, body) => {
    const turn: SavedTurn = {
      user: {
        ...user,
        id: 'u2',
        request_id: body.request_id,
        position: 3,
        content: body.question,
      },
      assistant: {
        ...assistant,
        id: 'a2',
        request_id: body.request_id,
        position: 4,
      },
      duplicate: false,
    }
    transcript = [...transcript, turn.user, turn.assistant]
    return turn
  })
})
function mount(query = '?conversation=one') {
  return render(
    <MemoryRouter initialEntries={['/chat' + query]}>
      <ConversationChat />
    </MemoryRouter>,
  )
}
async function loaded() {
  await screen.findByRole('heading', { name: first.title })
}

describe('Saved conversations', () => {
  it('keeps retrieved fallback excerpts distinct from accepted answer claims', async () => {
    vi.mocked(api.getDocument).mockResolvedValue(
      (await api.listSearchDocuments(null)).items[0],
    )
    transcript = [
      user,
      {
        ...assistant,
        answer: {
          ...answer,
          status: 'unreliable',
          answer: 'No generated claims passed.',
          claims: [],
          evidence_fallback: [
            { ...citation, excerpt: '<script>source text</script>' },
          ],
        },
        citation_state: 'available',
      },
    ]
    mount()
    await screen.findByText('No generated claims passed.')
    await userEvent.click(
      screen.getByText('Retrieved source excerpts · not an answer'),
    )
    expect(
      screen.getByText(/not verified facts or accepted answer claims/),
    ).toBeInTheDocument()
    expect(screen.getByText('<script>source text</script>')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Answer claims' })).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'safety.pdf · Page 2' }),
    )
    await screen.findByRole('dialog', { name: '' })
    expect(api.getDocument).toHaveBeenCalledWith('doc', expect.any(AbortSignal))
  })

  it('resets the reading position and pending UI when switching discussions', async () => {
    mount()
    await loaded()
    const pane = screen.getByRole('list', { name: 'Conversation messages' })
    Object.defineProperties(pane, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 200 },
    })
    pane.scrollTop = 100
    fireEvent.scroll(pane)
    expect(
      screen.getByRole('button', { name: 'Jump to latest' }),
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /Finance discussion/ }),
    )
    await screen.findByRole('heading', { name: 'Finance discussion' })
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()
    expect(screen.queryByText('You · submitting')).toBeNull()
  })
  it('shows submission immediately, supports Enter and keeps Shift+Enter as a newline', async () => {
    vi.mocked(api.askConversation).mockReturnValue(new Promise(() => {}))
    mount()
    await loaded()
    const input = screen.getByLabelText('Your question')
    await userEvent.type(
      input,
      'Advanced requirements{Shift>}{Enter}{/Shift}Please',
    )
    expect(input).toHaveValue('Advanced requirements\nPlease')
    expect(api.askConversation).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(api.askConversation).toHaveBeenCalledTimes(1)
    expect(screen.getByText('You · submitting')).toBeInTheDocument()
    expect(screen.getByText(/Thinking · finding evidence/)).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(input).toBeDisabled()
  })

  it.each([true, false])(
    'follows completion only while pinned to latest: %s',
    async (manualScroll) => {
      let finish!: (value: SavedTurn) => void
      vi.mocked(api.askConversation).mockReturnValue(
        new Promise((done) => {
          finish = done
        }),
      )
      mount()
      await loaded()
      const pane = screen.getByRole('list', { name: 'Conversation messages' })
      let height = 1000
      Object.defineProperties(pane, {
        scrollHeight: { configurable: true, get: () => height },
        clientHeight: { configurable: true, value: 200 },
      })
      await userEvent.type(
        screen.getByLabelText('Your question'),
        'A new question',
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Send question' }),
      )
      expect(pane.scrollTop).toBe(1000)
      if (manualScroll) {
        pane.scrollTop = 150
        fireEvent.scroll(pane)
        expect(
          screen.getByRole('button', { name: 'Jump to latest' }),
        ).toBeInTheDocument()
      }
      height = 1400
      const body = vi.mocked(api.askConversation).mock.calls[0][1]
      const next = {
        ...user,
        id: 'next-u',
        position: 3,
        request_id: body.request_id,
        content: body.question,
      }
      const reply = {
        ...assistant,
        id: 'next-a',
        position: 4,
        request_id: body.request_id,
        content: 'New assistant response',
      }
      transcript = [...transcript, next, reply]
      await act(async () =>
        finish({ user: next, assistant: reply, duplicate: false }),
      )
      await screen.findByText(reply.content)
      expect(pane.scrollTop).toBe(manualScroll ? 150 : 1400)
      expect(screen.queryByText('You · submitting')).toBeNull()
      if (manualScroll) {
        await userEvent.click(
          screen.getByRole('button', { name: 'Jump to latest' }),
        )
        expect(pane.scrollTop).toBe(1400)
        expect(
          screen.queryByRole('button', { name: 'Jump to latest' }),
        ).toBeNull()
      }
    },
  )

  it('preserves the reading anchor when older messages are prepended', async () => {
    const all = Array.from({ length: 22 }, (_, index) => ({
      ...user,
      id: `old-${index}`,
      position: index,
      content: `Older ${index}`,
    }))
    vi.mocked(api.getConversationMessages).mockImplementation(
      async (_id, offset = 0) => ({
        items: offset ? all.slice(0, 2) : all.slice(2),
        total: 22,
        limit: 20,
        offset,
      }),
    )
    mount()
    await loaded()
    const pane = screen.getByRole('list', { name: 'Conversation messages' })
    Object.defineProperties(pane, {
      scrollHeight: {
        configurable: true,
        get: () => pane.children.length * 100,
      },
      clientHeight: { configurable: true, value: 200 },
    })
    pane.scrollTop = 300
    fireEvent.scroll(pane)
    await userEvent.click(
      screen.getByRole('button', { name: 'Load older messages' }),
    )
    await screen.findByText('Older 0')
    expect(pane.scrollTop).toBe(500)
  })

  it('exposes an uncertain submission beside its pending turn and reuses the key', async () => {
    vi.mocked(api.askConversation).mockRejectedValue(
      new Error('Network unavailable'),
    )
    mount()
    await loaded()
    await userEvent.type(
      screen.getByLabelText('Your question'),
      'Keep this question',
    )
    await userEvent.keyboard('{Enter}')
    await screen.findByText(/Submission status unknown/)
    const body = vi.mocked(api.askConversation).mock.calls[0][1]
    await userEvent.click(
      screen.getByRole('button', { name: /Check submission/ }),
    )
    expect(vi.mocked(api.askConversation).mock.calls[1][1]).toEqual(body)
    expect(screen.getAllByText('Keep this question')).toHaveLength(1)
  })
  it('loads older pages in stable message order without duplicate rows', async () => {
    const all = Array.from({ length: 22 }, (_, index) => ({
      ...user,
      id: `message-${index + 1}`,
      position: index + 1,
      content: `Saved message ${index + 1}`,
    }))
    vi.mocked(api.getConversationMessages).mockImplementation(
      async (_id, offset = 0) => ({
        items: offset === 0 ? all.slice(2) : all.slice(0, 2),
        total: 22,
        limit: 20,
        offset,
      }),
    )
    mount()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Load older messages' }),
    )
    await screen.findByText('Saved message 1')
    expect(api.getConversationMessages).toHaveBeenLastCalledWith('one', 20)
    expect(
      screen.getByRole('list', { name: 'Conversation messages' }).children,
    ).toHaveLength(22)
  })
  it('creates a named immutable discussion with selected document scope', async () => {
    mount('')
    await screen.findByRole('option', { name: 'safety.pdf' })
    await userEvent.selectOptions(
      screen.getByLabelText('Collection scope'),
      'group',
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Document scope')).toBeEnabled(),
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Document scope'),
      'doc',
    )
    await userEvent.clear(screen.getByLabelText('Conversation title'))
    await userEvent.type(
      screen.getByLabelText('Conversation title'),
      'My discussion',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Create conversation' }),
    )
    await loaded()
    expect(api.createConversation).toHaveBeenCalledWith({
      title: 'My discussion',
      collection_id: 'group',
      document_id: 'doc',
    })
    expect(screen.getByText('Document: safety.pdf')).toBeInTheDocument()
    expect(screen.queryByLabelText('Document scope')).toBeNull()
  })
  it('loads saved messages again after a browser component reload', async () => {
    const view = mount()
    await screen.findByText(assistant.content)
    view.unmount()
    mount()
    await screen.findByText(user.content)
    expect(api.getConversationMessages).toHaveBeenCalledTimes(2)
    expect(api.askConversation).not.toHaveBeenCalled()
  })
  it('switches conversations without allowing an older load to overwrite the selection', async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof api.getConversationMessages>>,
    ) => void
    vi.mocked(api.getConversationMessages).mockImplementation((id) =>
      id === 'one'
        ? new Promise((done) => {
            resolve = done
          })
        : Promise.resolve({
            items: [{ ...assistant, id: 'different', content: 'Finance only' }],
            total: 1,
            limit: 20,
            offset: 0,
          }),
    )
    mount()
    await userEvent.click(
      await screen.findByRole('button', { name: /Finance discussion/ }),
    )
    await screen.findByText('Finance only')
    await act(async () =>
      resolve({
        items: [{ ...assistant, content: 'Late private result' }],
        total: 1,
        limit: 20,
        offset: 0,
      }),
    )
    expect(screen.queryByText('Late private result')).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Finance discussion' }),
    ).toBeInTheDocument()
  })
  it('submits one request key and prevents repeated send clicks', async () => {
    mount()
    await loaded()
    await userEvent.type(
      screen.getByLabelText('Your question'),
      'Which of those are mandatory?',
    )
    await userEvent.dblClick(
      screen.getByRole('button', { name: 'Send question' }),
    )
    await waitFor(() => expect(api.askConversation).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.askConversation).mock.calls[0][1]).toEqual({
      request_id: expect.any(String),
      question: 'Which of those are mandatory?',
      top_k: 5,
    })
    await screen.findByText('Which of those are mandatory?')
  })
  it('reuses the same request key after an uncertain transport failure', async () => {
    vi.mocked(api.askConversation).mockRejectedValueOnce(
      new Error('Connection interrupted'),
    )
    mount()
    await loaded()
    await userEvent.type(screen.getByLabelText('Your question'), 'Follow up')
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }))
    await screen.findByText('Connection interrupted')
    await userEvent.click(
      screen.getByRole('button', { name: /Check submission/ }),
    )
    await waitFor(() => expect(api.askConversation).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.askConversation).mock.calls[1][1]).toEqual(
      vi.mocked(api.askConversation).mock.calls[0][1],
    )
  })
  it('shows saved generation failures and prepares an explicit new-turn retry', async () => {
    transcript = [
      user,
      {
        ...assistant,
        status: 'failed',
        error_code: 'chat_unavailable',
        content: 'Generation failed safely.',
      },
    ]
    mount()
    await screen.findByText('Generation failed safely.')
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry question as a new turn' }),
    )
    expect(screen.getByLabelText('Your question')).toHaveValue(user.content)
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }))
    await waitFor(() => expect(api.askConversation).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.askConversation).mock.calls[0][1].request_id).not.toBe(
      user.request_id,
    )
  })
  it.each(['stale', 'unavailable'] as const)(
    'keeps %s sources historical and disables citation navigation',
    async (state) => {
      transcript = [user, { ...assistant, answer, citation_state: state }]
      mount()
      const button = await screen.findByRole('button', {
        name: 'Open citation 1: safety.pdf, page 2',
      })
      expect(button).toBeDisabled()
      await userEvent.click(button)
      expect(api.getDocument).not.toHaveBeenCalled()
      expect(
        screen.getByText(
          new RegExp(`Historical source availability: ${state}`),
        ),
      ).toBeInTheDocument()
    },
  )
  it('opens available saved citations at the checked original page', async () => {
    transcript = [user, { ...assistant, answer, citation_state: 'available' }]
    vi.mocked(api.getDocument).mockResolvedValue(
      (await api.listSearchDocuments(null)).items[0],
    )
    mount()
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Open citation 1: safety.pdf, page 2',
      }),
    )
    expect(await screen.findByRole('dialog')).toHaveTextContent('PDF page 2')
  })
  it('recovers message-loading errors with an explicit refresh', async () => {
    vi.mocked(api.getConversationMessages).mockRejectedValueOnce(
      new Error('Saved messages unavailable'),
    )
    mount()
    await screen.findByText('Saved messages unavailable')
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry loading conversation' }),
    )
    await screen.findByText(user.content)
  })
  it('supports empty discussions and pending turns without claiming success', async () => {
    transcript = []
    const view = mount()
    await screen.findByText(/No messages yet/)
    view.unmount()
    transcript = [user, { ...assistant, status: 'pending', content: '' }]
    vi.mocked(api.getConversation).mockResolvedValue({
      ...first,
      generating: true,
    })
    mount()
    await screen.findByText(/Thinking · finding evidence/)
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
  })
  it('renames and confirms deletion without deleting original documents', async () => {
    mount()
    await loaded()
    await userEvent.click(
      screen.getByRole('button', { name: 'Rename conversation' }),
    )
    const dialog = screen.getByRole('dialog')
    await userEvent.clear(within(dialog).getByLabelText('Conversation title'))
    await userEvent.type(
      within(dialog).getByLabelText('Conversation title'),
      'Updated discussion',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await screen.findByRole('heading', { name: 'Updated discussion' })
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete conversation' }),
    )
    expect(api.deleteConversation).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm deletion' }),
    )
    await waitFor(() =>
      expect(api.deleteConversation).toHaveBeenCalledWith('one'),
    )
    await screen.findByRole('heading', { name: 'Start a saved conversation' })
  })
  it('renders stored user content as plain text', async () => {
    transcript = [
      { ...user, content: '<img src=x onerror=alert(1)> https://evil.test' },
      assistant,
    ]
    const view = mount()
    await screen.findByText(transcript[0].content)
    expect(
      view.container.querySelector('img[src="x"],a[href="https://evil.test"]'),
    ).toBeNull()
  })
})
