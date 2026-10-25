import type { ComponentPropsWithRef } from 'react'
import type { StatusTone } from './Badge'

export function StatusIndicator({
  tone = 'neutral',
  loading = false,
  className = '',
  children,
  ...props
}: ComponentPropsWithRef<'span'> & { tone?: StatusTone; loading?: boolean }) {
  return (
    <span
      {...props}
      className={`status-indicator ${className}`}
      data-tone={tone}
    >
      <span
        aria-hidden="true"
        className={loading ? 'loading-spinner' : 'status-dot'}
      />
      {children}
    </span>
  )
}
