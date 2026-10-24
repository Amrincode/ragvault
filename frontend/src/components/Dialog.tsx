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
    dialog?.showModal()
    dialog?.querySelector<HTMLElement>('input, select, textarea')?.focus()
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={reference}
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      className={`m-auto max-h-[92vh] w-[calc(100%-2rem)] overflow-auto rounded-2xl border border-line bg-white p-6 text-ink shadow-xl backdrop:bg-forest/50 ${wide ? 'max-w-5xl' : 'max-w-md'}`}
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 id={heading} className="min-w-0 break-words text-lg font-semibold">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-xl text-muted hover:bg-canvas disabled:opacity-40"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  )
}
