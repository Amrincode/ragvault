import type { ReactNode } from 'react'

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string
  description: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
      {icon && (
        <span
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-card bg-accent-soft text-accent"
        >
          {icon}
        </span>
      )}
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
