import { afterEach, describe, expect, it, vi } from 'vitest'
import { getHealth } from './api'

afterEach(() => vi.unstubAllGlobals())

const healthy = {
  status: 'ok',
  application: 'ok',
  database: { status: 'connected' },
  ollama: { status: 'connected' },
}

describe('health API client', () => {
  it('returns a successful health response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(healthy))),
    )
    await expect(getHealth()).resolves.toEqual(healthy)
  })

  it('preserves structured dependency failures on HTTP 503', async () => {
    const degraded = {
      ...healthy,
      status: 'degraded',
      ollama: {
        status: 'unavailable',
        detail: 'Ollama connectivity check failed',
      },
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(degraded), { status: 503 }),
        ),
    )
    await expect(getHealth()).resolves.toEqual(degraded)
  })

  it('rejects malformed health responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"status":"ok"}')),
    )
    await expect(getHealth()).rejects.toThrow('invalid health response')
  })

  it('rejects unrelated server failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 500 })),
    )
    await expect(getHealth()).rejects.toThrow('HTTP 500')
  })

  it('propagates network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    await expect(getHealth()).rejects.toThrow('Failed to fetch')
  })
})
