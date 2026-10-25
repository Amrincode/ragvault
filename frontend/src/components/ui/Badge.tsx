import type { ComponentPropsWithRef } from 'react'

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function Badge({
  tone = 'neutral',
  className = '',
  ...props
}: ComponentPropsWithRef<'span'> & { tone?: StatusTone }) {
  return <span {...props} className={`badge ${className}`} data-tone={tone} />
}
