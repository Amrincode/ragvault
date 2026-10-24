import { useCallback, useEffect, useRef, useState } from 'react'
import { getHealth } from '../lib/api'
import type { HealthResponse } from '../types/health'

export function useHealth() {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setChecking(true)
    try {
      const result = await getHealth(controller.signal)
      if (!controller.signal.aborted) {
        setData(result)
        setError(null)
        setCheckedAt(new Date())
      }
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        setData(null)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to reach the backend',
        )
        setCheckedAt(new Date())
      }
    } finally {
      if (!controller.signal.aborted) setChecking(false)
    }
  }, [])

  useEffect(() => {
    const initialCheck = window.setTimeout(() => {
      void refresh()
    }, 0)
    const interval = window.setInterval(() => {
      void refresh()
    }, 30_000)
    return () => {
      window.clearTimeout(initialCheck)
      window.clearInterval(interval)
      controllerRef.current?.abort()
    }
  }, [refresh])

  return { data, error, checking, checkedAt, refresh }
}
