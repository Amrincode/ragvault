import { isHealthResponse, type HealthResponse } from '../types/health'
import type { SearchInput, SearchResponse } from '../types/search'
import type { ChatInput, ChatResponse } from '../types/chat'
import type {
  Conversation,
  ConversationPage,
  MessagePage,
  SavedTurn,
  TurnInput,
} from '../types/conversations'
import type {
  Collection,
  Document,
  DocumentPage,
  LibraryConfig,
  ChunkPage,
} from '../types/library'

export const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
).replace(/\/+$/, '')

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${apiBaseUrl}/api/health`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(signal ? [signal] : []),
    ]),
  })
  // A 503 with a valid health body is a reachable API with an unavailable dependency.
  if (!response.ok && response.status !== 503) {
    throw new Error(`Backend returned HTTP ${response.status}`)
  }
  const payload: unknown = await response.json()
  if (!isHealthResponse(payload))
    throw new Error('Backend returned an invalid health response')
  return payload
}

async function libraryRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    cache: 'no-store',
    signal: AbortSignal.any([
      AbortSignal.timeout(
        path === '/api/chat' ||
          (path.startsWith('/api/conversations/') && path.endsWith('/messages'))
          ? 600_000
          : path.endsWith('/index')
            ? 660_000
            : path.endsWith('/process')
              ? 240_000
              : 120_000,
      ),
      ...(options.signal ? [options.signal] : []),
    ]),
    headers: {
      Accept: 'application/json',
      ...(options.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  })
  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status})`
    try {
      const payload = (await response.json()) as {
        detail?: string | { message?: string } | { msg: string }[]
      }
      const detail = payload.detail
      if (typeof detail === 'string') message = detail
      else if (Array.isArray(detail))
        message = detail.map((item) => item.msg).join('; ')
      else if (detail?.message) message = detail.message
    } catch {
      /* Keep the HTTP fallback if a proxy returned a non-JSON error. */
    }
    throw new Error(message)
  }
  return response
}

async function jsonRequest<T>(path: string, options?: RequestInit): Promise<T> {
  return (await libraryRequest(path, options)).json() as Promise<T>
}

export const listCollections = (signal?: AbortSignal) =>
  jsonRequest<Collection[]>('/api/collections', { signal })
export const getLibraryConfig = (signal?: AbortSignal) =>
  jsonRequest<LibraryConfig>('/api/library/config', { signal })
export const createCollection = (name: string) =>
  jsonRequest<Collection>('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
export const renameCollection = (id: string, name: string) =>
  jsonRequest<Collection>(`/api/collections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
export async function deleteCollection(id: string): Promise<void> {
  await libraryRequest(`/api/collections/${id}`, { method: 'DELETE' })
}
export function listDocuments(
  collectionId: string | null,
  offset: number,
  signal?: AbortSignal,
): Promise<DocumentPage> {
  const parameters = new URLSearchParams({
    limit: '20',
    offset: String(offset),
  })
  if (collectionId) parameters.set('collection_id', collectionId)
  return jsonRequest<DocumentPage>(`/api/documents?${parameters}`, { signal })
}
export function uploadDocument(
  collectionId: string,
  file: File,
): Promise<Document> {
  const body = new FormData()
  body.append('file', file)
  return jsonRequest<Document>(`/api/collections/${collectionId}/documents`, {
    method: 'POST',
    body,
  })
}
export const renameDocument = (id: string, filename: string) =>
  jsonRequest<Document>(`/api/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ filename }),
  })
export const processDocument = (id: string) =>
  jsonRequest<Document>(`/api/documents/${id}/process`, { method: 'POST' })
export const indexDocument = (id: string) =>
  jsonRequest<Document>(`/api/documents/${id}/index`, { method: 'POST' })
export const getIndexingStatus = (id: string, signal?: AbortSignal) =>
  jsonRequest<Document>(`/api/documents/${id}/indexing`, { signal })
export const getDocument = (id: string, signal?: AbortSignal) =>
  jsonRequest<Document>(`/api/documents/${id}`, { signal })
export function listSearchDocuments(
  collectionId: string | null,
  offset = 0,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ limit: '100', offset: String(offset) })
  if (collectionId) params.set('collection_id', collectionId)
  return jsonRequest<DocumentPage>(`/api/documents?${params}`, { signal })
}
export const searchPassages = (body: SearchInput, signal?: AbortSignal) =>
  jsonRequest<SearchResponse>('/api/search', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  })
export const askDocuments = (body: ChatInput, signal?: AbortSignal) =>
  jsonRequest<ChatResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  })
export const listConversations = (offset = 0, signal?: AbortSignal) =>
  jsonRequest<ConversationPage>(
    `/api/conversations?limit=20&offset=${offset}`,
    { signal },
  )
export const createConversation = (body: {
  title: string
  collection_id: string | null
  document_id: string | null
}) =>
  jsonRequest<Conversation>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify(body),
  })
export const getConversation = (id: string, signal?: AbortSignal) =>
  jsonRequest<Conversation>(`/api/conversations/${id}`, { signal })
export const renameConversation = (id: string, title: string) =>
  jsonRequest<Conversation>(`/api/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
export async function deleteConversation(id: string) {
  await libraryRequest(`/api/conversations/${id}`, { method: 'DELETE' })
}
export const getConversationMessages = (
  id: string,
  offset = 0,
  signal?: AbortSignal,
) =>
  jsonRequest<MessagePage>(
    `/api/conversations/${id}/messages?limit=20&offset=${offset}`,
    { signal },
  )
export const askConversation = (
  id: string,
  body: TurnInput,
  signal?: AbortSignal,
) =>
  jsonRequest<SavedTurn>(`/api/conversations/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  })
export const getProcessingStatus = (id: string, signal?: AbortSignal) =>
  jsonRequest<Document>(`/api/documents/${id}/processing`, { signal })
export const listDocumentChunks = (
  id: string,
  offset = 0,
  signal?: AbortSignal,
) =>
  jsonRequest<ChunkPage>(
    `/api/documents/${id}/chunks?limit=20&offset=${offset}`,
    { signal },
  )
export async function deleteDocument(id: string): Promise<void> {
  await libraryRequest(`/api/documents/${id}`, { method: 'DELETE' })
}
export const documentDownloadUrl = (id: string) =>
  `${apiBaseUrl}/api/documents/${id}/file?download=true`
export async function getDocumentPDF(
  id: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await libraryRequest(`/api/documents/${id}/file`, { signal })
  return response.blob()
}
