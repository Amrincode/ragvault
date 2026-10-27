import { useEffect, useId, useRef, type ReactNode } from 'react'

export function Dialog({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
  reader = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
  wide?: boolean
  reader?: boolean
}) {
  const reference = useRef<HTMLDialogElement>(null)
  const heading = useId()
  useEffect(() => {
    const dialog = reference.current
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    dialog?.showModal()
    const firstControl =
      dialog?.querySelector<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
      ) ?? dialog?.querySelector<HTMLElement>('button:not(:disabled)')
    firstControl?.focus()
    return () => {
      dialog?.close()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])
  return (
    <dialog
      ref={reference}
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      className={`m-auto overflow-auto rounded-2xl border border-line bg-elevated text-ink shadow-card backdrop:bg-overlay/70 ${reader ? 'max-h-[96dvh] w-[calc(100%-1rem)] max-w-6xl p-3 [scrollbar-gutter:stable] sm:p-5' : `max-h-[92vh] w-[calc(100%-2rem)] p-6 ${wide ? 'max-w-5xl' : 'max-w-md'}`}`}
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2
          id={heading}
          className={`min-w-0 break-words text-section font-semibold ${reader ? 'line-clamp-2 [overflow-wrap:anywhere]' : ''}`}
          title={reader ? title : undefined}
        >
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
          className="min-h-10 min-w-10 rounded-lg px-2 py-1 text-xl text-muted hover:bg-canvas disabled:opacity-40"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  )
}
