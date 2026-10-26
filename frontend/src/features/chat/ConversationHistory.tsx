import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/Icon'
import { LoadingIndicator } from '../../components/ui/LoadingIndicator'
import type { ConversationPage } from '../../types/conversations'

export function ConversationHistory({
  list,
  error,
  selected,
  offset,
  choose,
  retry,
  paginate,
}: {
  list: ConversationPage | null
  error: string | null
  selected: string
  offset: number
  choose: (id: string) => void
  retry: () => void
  paginate: (offset: number) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <p className="eyebrow mb-3">YOUR CONVERSATIONS</p>
        <Button className="w-full" onClick={() => choose('')}>
          <Icon name="plus" />
          New conversation
        </Button>
      </div>
      {error && (
        <div role="alert" className="error-message">
          {error}
          <Button variant="ghost" size="sm" className="mt-2" onClick={retry}>
            Retry conversation list
          </Button>
        </div>
      )}
      {!list && !error && <LoadingIndicator label="Loading conversations…" />}
      {list?.total === 0 && (
        <p className="text-sm leading-6 text-muted">
          No conversations yet. Start with a question about your indexed PDFs.
        </p>
      )}
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto [scrollbar-gutter:stable]">
        {list?.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={selected === item.id}
              onClick={() => choose(item.id)}
              className="w-full rounded-control border border-transparent px-3 py-3 text-left hover:bg-canvas aria-pressed:border-control-border aria-pressed:bg-accent-soft aria-pressed:text-accent"
            >
              <span className="block break-words text-sm font-medium [overflow-wrap:anywhere]">
                {item.title}
              </span>
              <span className="mt-1 block text-xs text-muted">
                {item.generating
                  ? 'Generating…'
                  : new Date(item.updated_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                {selected === item.id && ' · Current'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {list && list.total > 20 && (
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs text-muted">
            {offset + 1}–{Math.min(offset + 20, list.total)} of {list.total}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!offset}
              onClick={() => paginate(Math.max(0, offset - 20))}
              aria-label="Previous conversations"
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + 20 >= list.total}
              onClick={() => paginate(offset + 20)}
              aria-label="Next conversations"
            >
              Next
            </Button>
          </div>
        </div>
      )}
      <p className="border-t border-line pt-3 text-xs leading-5 text-muted">
        Saved in this workspace. Each turn retrieves fresh evidence within its
        fixed scope.
      </p>
    </div>
  )
}
