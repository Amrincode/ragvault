import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { Icon, type IconName } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingIndicator } from '../components/ui/LoadingIndicator'
import { useHealth } from '../hooks/useHealth'
import { useDashboard } from '../hooks/useDashboard'
import { formatBytes } from '../lib/format'

const actions: {
  title: string
  description: string
  to: string
  icon: IconName
}[] = [
  {
    title: 'Upload documents',
    description: 'Choose a collection and add your PDFs.',
    to: '/documents',
    icon: 'upload',
  },
  {
    title: 'Browse documents',
    description: 'Organize, preview and index your library.',
    to: '/documents',
    icon: 'documents',
  },
  {
    title: 'Semantic search',
    description: 'Find relevant passages in indexed PDFs.',
    to: '/search',
    icon: 'search',
  },
  {
    title: 'Document chat',
    description: 'Ask questions and inspect cited sources.',
    to: '/chat',
    icon: 'chat',
  },
]
function Metric({
  title,
  value,
  loading,
  error,
  icon,
}: {
  title: string
  value?: number
  loading: boolean
  error: boolean
  icon: IconName
}) {
  return (
    <Card className="p-5 sm:p-6" role="group" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        <Icon name={icon} className="text-accent" />
      </div>
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingIndicator label="Loading total…" />
        ) : error ? (
          <p className="text-sm text-muted">Unavailable</p>
        ) : (
          <p className="text-3xl font-semibold tracking-tight tabular-nums">
            {value?.toLocaleString()}
          </p>
        )}
      </div>
    </Card>
  )
}
export function DashboardPage() {
  const workspace = useDashboard()
  const health = useHealth()
  const hasError =
    workspace.documents.error ||
    workspace.collections.error ||
    workspace.conversations.error
  const loading =
    workspace.documents.loading ||
    workspace.collections.loading ||
    workspace.conversations.loading
  const services: {
    name: string
    description: string
    icon: IconName
    state: 'checking' | 'connected' | 'unavailable' | 'unknown'
  }[] = [
    {
      name: 'FastAPI',
      description: 'Application server',
      icon: 'server',
      state: health.checking
        ? 'checking'
        : health.data
          ? 'connected'
          : 'unavailable',
    },
    {
      name: 'PostgreSQL',
      description: 'Database connection',
      icon: 'database',
      state: health.checking
        ? 'checking'
        : (health.data?.database.status ?? 'unknown'),
    },
    {
      name: 'Ollama',
      description: 'Local AI runtime',
      icon: 'activity',
      state: health.checking
        ? 'checking'
        : (health.data?.ollama.status ?? 'unknown'),
    },
  ]
  return (
    <AppShell>
      <section aria-labelledby="dashboard-title">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h1 id="dashboard-title" className="mt-2 text-page">
              Dashboard
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
              Your documents, conversations and local AI, in one place.
            </p>
          </div>
          <Link className="button" data-variant="primary" to="/documents">
            <Icon name="upload" />
            Upload documents
          </Link>
        </div>
        <p className="mt-4 text-meta text-muted">
          Uploads start in the document library. Choose or create a collection
          to add a PDF.
        </p>
        <div className="mt-7 grid gap-4 sm:grid-cols-3">
          <Metric
            title="Total documents"
            icon="documents"
            value={workspace.documents.data?.total}
            loading={workspace.documents.loading}
            error={workspace.documents.error}
          />
          <Metric
            title="Collections"
            icon="vault"
            value={workspace.collections.data?.length}
            loading={workspace.collections.loading}
            error={workspace.collections.error}
          />
          <Metric
            title="Saved conversations"
            icon="chat"
            value={workspace.conversations.data?.total}
            loading={workspace.conversations.loading}
            error={workspace.conversations.error}
          />
        </div>
        {hasError && (
          <div
            role="status"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-warning-border bg-warning-soft p-4 text-sm text-warning"
          >
            <p>
              Some workspace data could not be loaded. Available sections are
              still shown.
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={workspace.reload}
            >
              Retry workspace data
            </Button>
          </div>
        )}
      </section>
      <div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(16rem,1fr)]">
        <section aria-labelledby="recent-heading" className="min-w-0">
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5 sm:px-6">
              <div>
                <h2 id="recent-heading" className="text-section">
                  Recent documents
                </h2>
                <p className="mt-1 text-meta text-muted">Your latest uploads</p>
              </div>
              <Link
                to="/documents"
                className="text-sm font-semibold text-accent hover:underline"
              >
                View library<span className="sr-only"> of documents</span>
              </Link>
            </div>
            {workspace.documents.loading ? (
              <div className="p-6">
                <LoadingIndicator label="Loading recent documents…" />
              </div>
            ) : workspace.documents.error ? (
              <div role="status" className="p-6 text-sm text-muted">
                Recent documents are unavailable. Retry workspace data to check
                again.
              </div>
            ) : !workspace.documents.data?.items.length ? (
              <EmptyState
                title="Your library starts here"
                description="Add a PDF to a collection, then process and index it for search and grounded chat."
                icon={<Icon name="documents" />}
                action={
                  <Link
                    to="/documents"
                    className="button"
                    data-variant="primary"
                  >
                    Add your first document
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {workspace.documents.data.items.slice(0, 5).map((doc) => {
                  const collection = workspace.collections.data?.find(
                    (item) => item.id === doc.collection_id,
                  )
                  const status =
                    doc.indexing_status === 'indexed'
                      ? 'Indexed'
                      : doc.indexing_status === 'indexing'
                        ? 'Indexing'
                        : doc.indexing_status === 'failed'
                          ? 'Indexing failed'
                          : {
                              uploaded: 'Uploaded',
                              processing: 'Processing',
                              processed: 'Processed',
                              failed: 'Processing failed',
                              no_text: 'No text',
                            }[doc.processing_status]
                  return (
                    <li
                      key={doc.id}
                      className="flex min-w-0 items-start gap-3 p-5 sm:px-6"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent">
                        <Icon name="documents" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="break-words text-sm font-semibold [overflow-wrap:anywhere]">
                          {doc.filename}
                        </h3>
                        <p className="mt-1 break-words text-meta text-muted [overflow-wrap:anywhere]">
                          {collection ? `${collection.name} · ` : ''}
                          {formatBytes(doc.file_size)} ·{' '}
                          <time dateTime={doc.created_at}>
                            {new Date(doc.created_at).toLocaleDateString(
                              undefined,
                              {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              },
                            )}
                          </time>
                        </p>
                        <div className="mt-2">
                          <Badge
                            tone={
                              status === 'Indexed'
                                ? 'success'
                                : status.includes('failed')
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {status}
                          </Badge>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="border-t border-line px-5 py-4 text-meta text-muted sm:px-6">
              Preview, process and manage documents in the{' '}
              <Link
                to="/documents"
                className="font-medium text-accent hover:underline"
              >
                document library
              </Link>
              .
            </p>
          </Card>
        </section>
        <section aria-labelledby="actions-heading">
          <Card className="p-5 sm:p-6">
            <h2 id="actions-heading" className="text-section">
              Quick actions
            </h2>
            <div className="mt-4 flex flex-col gap-1">
              {actions.map((action) => (
                <Link
                  key={action.title}
                  to={action.to}
                  className="group flex items-start gap-3 rounded-control px-2 py-3 hover:bg-canvas"
                >
                  <Icon name={action.icon} className="mt-0.5 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-semibold group-hover:text-accent">
                      {action.title}
                    </span>
                    <span className="mt-1 block text-meta text-muted">
                      {action.description}
                    </span>
                  </span>
                  <Icon name="arrow" className="mt-0.5 size-4 text-muted" />
                </Link>
              ))}
            </div>
          </Card>
          <p className="mt-4 px-1 text-meta leading-5 text-muted">
            AI answers can be incomplete or incorrect. Review citations and
            original pages.
          </p>
        </section>
      </div>
      <section className="mt-8" aria-labelledby="health-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="health-heading" className="text-section">
              System status
            </h2>
            <p aria-live="polite" className="mt-1 text-meta text-muted">
              {health.checking
                ? 'Checking services…'
                : health.data?.status === 'ok'
                  ? 'All services connected'
                  : health.data
                    ? 'Some services need attention'
                    : 'Backend health could not be checked'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={health.checking}
            onClick={() => {
              void health.refresh()
            }}
          >
            <Icon name="refresh" className="size-4" />
            Refresh status
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {services.map((service) => (
            <Card key={service.name} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Icon name={service.icon} className="text-muted" />
                <StatusBadge state={service.state} />
              </div>
              <h3 className="mt-4 text-sm font-semibold">{service.name}</h3>
              <p className="mt-1 text-meta text-muted">{service.description}</p>
            </Card>
          ))}
        </div>
        {health.error && (
          <p role="status" className="mt-3 text-sm text-warning">
            The health check failed. The API may be offline or unreachable;
            dependency status is unknown. Retry with Refresh status.
          </p>
        )}
        {health.data?.status === 'degraded' && (
          <p role="status" className="mt-3 text-sm text-warning">
            The API is reachable, but a dependency is unavailable. Search or AI
            answers may be affected.
          </p>
        )}
        <p className="mt-3 text-meta text-muted">
          {health.checkedAt
            ? `Last checked ${health.checkedAt.toLocaleTimeString()}`
            : 'Waiting for first check'}{' '}
          · Automatically checks every 30 seconds. Connectivity does not confirm
          model readiness.
        </p>
      </section>
    </AppShell>
  )
}
