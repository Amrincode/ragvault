import { AppShell } from '../components/AppShell'
import { Icon, type IconName } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'
import { useHealth } from '../hooks/useHealth'
import { apiBaseUrl } from '../lib/api'
import { Link } from 'react-router'

export function DashboardPage() {
  const { data, error, checking, checkedAt, refresh } = useHealth()
  const state = (value?: 'connected' | 'unavailable') =>
    checking ? 'checking' : (value ?? 'unknown')
  const services: {
    name: string
    description: string
    icon: IconName
    state: ReturnType<typeof state>
  }[] = [
    {
      name: 'FastAPI',
      description: 'Application server',
      icon: 'server',
      state: checking ? 'checking' : data ? 'connected' : 'unavailable',
    },
    {
      name: 'PostgreSQL',
      description: 'Database connection',
      icon: 'database',
      state: state(data?.database.status),
    },
    {
      name: 'Ollama',
      description: 'Local runtime connectivity',
      icon: 'activity',
      state: state(data?.ollama.status),
    },
  ]

  return (
    <AppShell>
      <section id="overview" className="scroll-mt-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">YOUR LOCAL INTELLIGENCE WORKSPACE</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Your knowledge, close at hand.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
              Welcome to RAGVault. Your document intelligence workspace
              <br className="hidden xl:block" /> starts with a connected,
              dependable foundation.
            </p>
          </div>
          <a
            href="#system-health"
            className="inline-flex items-center gap-2 text-xs font-semibold text-forest"
          >
            View system health
            <Icon name="arrow" className="size-4" />
          </a>
        </div>

        <div className="relative mt-8 overflow-hidden rounded-2xl bg-forest p-7 text-white sm:p-8">
          <div className="pointer-events-none absolute -right-12 -top-24 size-80 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute -right-2 -top-14 size-60 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute right-10 -top-2 size-36 rounded-full border border-white/10" />
          <div className="relative">
            <span className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-mint">
              <span className="size-1.5 rounded-full bg-mint" />
              MILESTONE 06 · SOURCE CITATIONS
            </span>
            <h2 className="mt-4 text-xl font-medium tracking-tight">
              A home for your original documents.
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">
              Organize PDFs into collections, preview originals, and manage your
              library locally.
              <br className="hidden sm:block" /> Process and index page-aware
              chunks, then search passages or ask questions with local AI.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs text-mint">
              <Icon name="check" className="size-3.5" />
              Single-user · Local-only
            </div>
          </div>
        </div>
      </section>

      <section
        id="system-health"
        className="mt-9 scroll-mt-8"
        aria-labelledby="health-heading"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2
              id="health-heading"
              className="text-base font-semibold text-ink"
            >
              System health
            </h2>
            <span aria-live="polite" className="text-xs text-muted">
              {checking
                ? 'Checking services…'
                : data?.status === 'ok'
                  ? 'All services connected'
                  : data
                    ? 'Attention needed'
                    : 'Backend unreachable'}
            </span>
          </div>
          <button
            type="button"
            disabled={checking}
            onClick={() => {
              void refresh()
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-ink transition hover:bg-stone-50 disabled:cursor-wait disabled:opacity-50"
          >
            <Icon
              name="refresh"
              className={`size-3.5 ${checking ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {services.map((service) => (
            <div
              key={service.name}
              className="rounded-xl border border-line bg-white p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="grid size-10 place-items-center rounded-xl bg-canvas text-forest">
                  <Icon name={service.icon} />
                </span>
                <StatusBadge state={service.state} />
              </div>
              <h3 className="mt-5 text-sm font-semibold text-ink">
                {service.name}
              </h3>
              <p className="mt-1 text-xs text-muted">{service.description}</p>
            </div>
          ))}
        </div>
        {error && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"
          >
            Cannot read backend health. Start the API and check the configured
            URL and CORS origin. {error}
          </div>
        )}
        {data?.status === 'degraded' && (
          <div
            role="status"
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"
          >
            The API is running.{' '}
            {data.database.detail ? `${data.database.detail}. ` : ''}
            {data.ollama.detail ? `${data.ollama.detail}.` : ''}
          </div>
        )}
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-muted">
          <span className="font-mono">GET {apiBaseUrl}/api/health</span>
          <span>
            {checkedAt
              ? `Last checked ${checkedAt.toLocaleTimeString()}`
              : 'Waiting for first check'}{' '}
            · Refreshes every 30s
          </span>
        </div>
      </section>

      <section className="mt-9" aria-labelledby="workspace-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="workspace-heading"
            className="text-base font-semibold text-ink"
          >
            Your workspace
          </h2>
          <span className="text-xs text-muted">Built in milestones</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <article
            id="documents"
            className="scroll-mt-8 rounded-xl border border-line bg-white p-6"
          >
            <div className="flex items-center justify-between">
              <Icon name="documents" className="size-6 text-forest" />
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-800">
                Available
              </span>
            </div>
            <h3 className="mt-5 font-semibold text-ink">Documents</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
              Create collections, upload validated PDFs, preview originals,
              rename files, and manage your local library.
            </p>
            <p className="mt-5 border-t border-line pt-4 text-xs text-muted">
              <Link
                to="/documents"
                className="font-semibold text-forest hover:underline"
              >
                Open document library →
              </Link>
            </p>
          </article>
          <article
            id="chat"
            className="scroll-mt-8 rounded-xl border border-line bg-white p-6"
          >
            <div className="flex items-center justify-between">
              <Icon name="chat" className="size-6 text-forest" />
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-800">
                Available
              </span>
            </div>
            <h3 className="mt-5 font-semibold text-ink">
              Chat with your knowledge
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
              Ask questions about indexed PDFs. Inspect cited claims, supporting
              excerpts and original pages. Source checks do not prove factual
              truth. Each question stands alone.
            </p>
            <p className="mt-5 border-t border-line pt-4 text-xs text-muted">
              <Link
                to="/chat"
                className="font-semibold text-forest hover:underline"
              >
                Open document chat →
              </Link>
            </p>
          </article>
        </div>
      </section>
      <footer className="mt-9 flex flex-wrap justify-between gap-2 border-t border-line pt-5 text-[10px] text-muted">
        <span>RAGVault · Local-first document intelligence</span>
        <span>React + FastAPI + PostgreSQL + Ollama</span>
      </footer>
    </AppShell>
  )
}
