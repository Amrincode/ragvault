import { useId, type Ref } from 'react'
import { Button } from '../../components/ui/Button'
import { Textarea } from '../../components/ui/Textarea'
import { Input } from '../../components/ui/Input'
import { Icon } from '../../components/Icon'

export function ChatComposer({
  question,
  onQuestion,
  topK,
  onTopK,
  onSend,
  disabled,
  busy,
  inputRef,
  recovery,
  single = false,
}: {
  question: string
  onQuestion: (value: string) => void
  topK: number
  onTopK: (value: number) => void
  onSend: () => void
  disabled: boolean
  busy: boolean
  inputRef?: Ref<HTMLTextAreaElement>
  recovery?: () => void
  single?: boolean
}) {
  const hint = useId()
  return (
    <form
      className="shrink-0 border-t border-line bg-surface p-3 sm:p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && !recovery && question.trim()) onSend()
      }}
    >
      <label className="sr-only" htmlFor={hint + '-question'}>
        Your question
      </label>
      <Textarea
        id={hint + '-question'}
        ref={inputRef}
        aria-describedby={hint}
        value={question}
        maxLength={2000}
        rows={2}
        disabled={disabled}
        placeholder="Ask a specific question about your indexed PDFs…"
        className="max-h-40 min-h-20 w-full text-body"
        onChange={(event) => onQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault()
            if (!disabled && !recovery && question.trim())
              event.currentTarget.form?.requestSubmit()
          }
        }}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <details className="min-w-0 text-meta text-muted">
          <summary
            className="min-h-9 cursor-pointer py-2"
            aria-label={`Retrieval options · ${topK} passages`}
          >
            <span aria-hidden="true" className="sm:hidden">
              {topK} passages
            </span>
            <span aria-hidden="true" className="hidden sm:inline">
              Retrieval options · {topK} passages
            </span>
          </summary>
          <label className="flex flex-wrap items-center gap-3 py-2">
            Passages to retrieve
            <Input
              type="number"
              min={1}
              max={20}
              step={1}
              required
              value={topK}
              disabled={disabled}
              className="w-20"
              onChange={(event) => onTopK(Number(event.target.value))}
            />
          </label>
          <p className="max-w-sm pb-2">
            More retrieved passages may not all fit in the model context. Limits
            and grounding checks are unchanged.
          </p>
        </details>
        {recovery ? (
          <Button disabled={busy} onClick={recovery}>
            Check submission · reuse request key
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={disabled || !question.trim()}
            loading={busy}
            aria-label={
              busy
                ? single
                  ? 'Preparing answer…'
                  : 'Saving and generating…'
                : single
                  ? 'Ask documents'
                  : 'Send question'
            }
          >
            <Icon name="arrow" className="size-4" />
            <span aria-hidden="true" className="sm:hidden">
              {busy ? 'Working…' : single ? 'Ask' : 'Send'}
            </span>
            <span aria-hidden="true" className="hidden sm:inline">
              {busy
                ? single
                  ? 'Preparing answer…'
                  : 'Saving and generating…'
                : single
                  ? 'Ask documents'
                  : 'Send question'}
            </span>
          </Button>
        )}
      </div>
      <p id={hint} className="mt-1 text-xs leading-5 text-muted">
        Enter to send · Shift+Enter for newline.{' '}
        <span className="hidden sm:inline">
          {single
            ? 'One question at a time; nothing is saved.'
            : 'Failed turns stay visible. Uncertain submissions reuse their request key.'}
        </span>
      </p>
    </form>
  )
}
