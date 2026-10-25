import { useEffect, useId, useRef, type ReactNode } from 'react'

export function Dialog({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
  wide?: boolean
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
      className={`m-auto max-h-[92vh] w-[calc(100%-2rem)] overflow-auto rounded-2xl border border-line bg-elevated p-6 text-ink shadow-card backdrop:bg-overlay/70 ${wide ? 'max-w-5xl' : 'max-w-md'}`}
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2
          id={heading}
          className="min-w-0 break-words text-section font-semibold"
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
