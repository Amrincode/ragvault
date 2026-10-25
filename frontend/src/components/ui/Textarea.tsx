import type { ComponentPropsWithRef } from 'react'

export function Textarea({
  className = '',
  rows = 3,
  ...props
}: ComponentPropsWithRef<'textarea'>) {
  return (
    <textarea
      {...props}
      rows={rows}
      className={`text-input min-h-24 resize-y ${className}`}
    />
  )
}
