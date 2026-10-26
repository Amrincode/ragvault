import type { ChatSource } from '../../types/chat'
import type { SavedMessage } from '../../types/conversations'
import { ClaimAnswer } from './ClaimAnswer'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/Icon'

export function ChatMessage({
  message,
  openSource,
  retry,
  disabled,
}: {
  message: SavedMessage
  openSource: (source: ChatSource) => void
  retry: () => void
  disabled: boolean
}) {
  const user = message.role === 'user'
  return (
    <li
      className={`min-w-0 ${user ? 'ml-auto w-fit max-w-[92%] rounded-card border border-line bg-accent-soft p-4 sm:max-w-[85%]' : 'w-full py-2'}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-meta">
        {!user && (
          <span className="grid size-7 place-items-center rounded-control border border-line bg-canvas text-accent">
            <Icon name="vault" className="size-4" />
          </span>
        )}
        <span className="font-semibold">{user ? 'You' : 'Assistant'}</span>
        <time
          dateTime={message.created_at}
          aria-label={new Date(message.created_at).toLocaleString()}
          title={new Date(message.created_at).toLocaleString()}
          className="text-xs text-muted"
        >
          {new Date(message.created_at).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
        {message.status === 'failed' && (
          <Badge tone="danger">Request failed</Badge>
        )}
        {message.answer && message.citation_state === 'available' && (
          <Badge>Sources available</Badge>
        )}
      </div>
      {message.status === 'pending' ? (
        <p role="status" className="text-sm leading-6 text-muted">
          Thinking · finding evidence in your PDFs… Searching documents and
          generating a response; replies appear when complete.
        </p>
      ) : message.answer ? (
        <>
          {message.citation_state !== 'none' &&
            message.citation_state !== 'available' && (
              <p className="mb-3 rounded-control border border-warning-border bg-warning-soft p-3 text-sm text-warning">
                Historical source availability: {message.citation_state}. Saved
                excerpts remain historical; original-page links are disabled.
              </p>
            )}
          <ClaimAnswer
            result={message.answer}
            onOpenSource={openSource}
            allowSources={message.citation_state === 'available'}
            compact
          />
        </>
      ) : (
        <p className="whitespace-pre-wrap break-words text-body leading-7">
          {message.content}
        </p>
      )}
      {message.citation_state === 'invalid' && !message.answer && (
        <p className="mt-2 text-meta text-warning">
          Saved citation data is invalid; no citation links are available.
        </p>
      )}
      {message.status === 'failed' && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          disabled={disabled}
          onClick={retry}
        >
          Retry question as a new turn
        </Button>
      )}
    </li>
  )
}
