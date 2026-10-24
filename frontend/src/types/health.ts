export interface DependencyHealth {
  status: 'connected' | 'unavailable'
  detail?: string
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  application: 'ok'
  database: DependencyHealth
  ollama: DependencyHealth
}

function isDependency(value: unknown): value is DependencyHealth {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    (item.status === 'connected' || item.status === 'unavailable') &&
    (item.detail === undefined || typeof item.detail === 'string')
  )
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    (item.status === 'ok' || item.status === 'degraded') &&
    item.application === 'ok' &&
    isDependency(item.database) &&
    isDependency(item.ollama)
  )
}
