import { isHealthResponse, type HealthResponse } from '../types/health'
import type {
  Collection,
  Document,
  DocumentPage,
  LibraryConfig,
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
      AbortSignal.timeout(120_000),
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
