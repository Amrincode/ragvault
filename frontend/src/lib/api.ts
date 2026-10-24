import { isHealthResponse, type HealthResponse } from '../types/health'

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
