import type { ComponentPropsWithRef } from 'react'

export function Input({
  className = '',
  ...props
}: ComponentPropsWithRef<'input'>) {
  return <input {...props} className={`text-input ${className}`} />
}
