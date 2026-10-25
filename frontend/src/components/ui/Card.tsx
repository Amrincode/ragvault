import type { ComponentPropsWithRef } from 'react'

export function Card({
  className = '',
  elevated = false,
  ...props
}: ComponentPropsWithRef<'div'> & { elevated?: boolean }) {
  return (
    <div
      {...props}
      className={`card ${className}`}
      data-elevated={elevated || undefined}
    />
  )
}
