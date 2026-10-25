import { Badge, type StatusTone } from './ui/Badge'
import { StatusIndicator } from './ui/StatusIndicator'

export function StatusBadge({
  state,
}: {
  state: 'connected' | 'unavailable' | 'unknown' | 'checking'
}) {
  const tones: Record<typeof state, StatusTone> = {
    connected: 'success',
    unavailable: 'warning',
    unknown: 'neutral',
    checking: 'accent',
  }
  const labels = {
    connected: 'Connected',
    unavailable: 'Unavailable',
    unknown: 'Not checked',
    checking: 'Checking',
  }
  return (
    <Badge tone={tones[state]}>
      <StatusIndicator tone={tones[state]} loading={state === 'checking'}>
        {labels[state]}
      </StatusIndicator>
    </Badge>
  )
}
