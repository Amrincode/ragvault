export function LoadingIndicator({
  label = 'Loading…',
  className = '',
}: {
  label?: string
  className?: string
}) {
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 text-sm text-muted ${className}`}
    >
      <span className="loading-spinner" aria-hidden="true" />
      {label}
    </span>
  )
}
