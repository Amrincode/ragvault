export function StatusBadge({
  state,
}: {
  state: 'connected' | 'unavailable' | 'unknown' | 'checking'
}) {
  const styles = {
    connected: 'bg-emerald-50 text-emerald-800',
    unavailable: 'bg-amber-50 text-amber-800',
    unknown: 'bg-stone-100 text-stone-500',
    checking: 'bg-sky-50 text-sky-800',
  }
  const labels = {
    connected: 'Connected',
    unavailable: 'Unavailable',
    unknown: 'Not checked',
    checking: 'Checking',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${styles[state]}`}
    >
      <span
        className={`size-1.5 rounded-full bg-current ${state === 'checking' ? 'animate-pulse' : ''}`}
      />
      {labels[state]}
    </span>
  )
}
