import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link, NavLink } from 'react-router'
import { Icon, type IconName } from './Icon'
import { ThemeSelector } from '../theme/ThemeSelector'

const destinations: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/documents', label: 'Documents', icon: 'documents' },
  { to: '/search', label: 'Semantic search', icon: 'search' },
  { to: '/chat', label: 'Document chat', icon: 'chat' },
]
function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-1.5">
      {destinations.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `nav-item ${isActive ? 'bg-nav-selected text-nav-ink' : 'text-nav-muted hover:bg-nav-hover hover:text-nav-ink'}`
          }
        >
          <Icon name={icon} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      to="/"
      onClick={onNavigate}
      className="flex min-h-12 items-center gap-3 rounded-control text-xl font-semibold tracking-tight"
    >
      <span className="grid size-10 place-items-center rounded-card border border-nav-line bg-nav-hover text-nav-accent">
        <Icon name="vault" className="size-6" />
      </span>
      <span>
        RAGVault
        <span className="mt-0.5 block text-xs font-normal tracking-normal text-nav-muted">
          Document intelligence
        </span>
        <span className="sr-only"> home</span>
      </span>
    </Link>
  )
}
function LocalNote() {
  return (
    <div className="mt-auto border-t border-nav-line pt-5 text-meta text-nav-muted">
      <p className="flex items-center gap-2 font-medium text-nav-accent">
        <Icon name="lock" className="size-4" />
        Local-first workspace
      </p>
      <p className="mt-2 leading-5">Your documents. Your machine.</p>
    </div>
  )
}
function MobileNavigation({
  onClose,
  onNavigate,
  id,
}: {
  onClose: () => void
  onNavigate: () => void
  id: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const previousOverflow = document.body.style.overflow
    dialog?.showModal()
    closeRef.current?.focus()
    document.body.style.overflow = 'hidden'
    const desktop = window.matchMedia('(min-width: 1024px)')
    const resize = () => {
      if (desktop.matches) onClose()
    }
    desktop.addEventListener('change', resize)
    resize()
    return () => {
      desktop.removeEventListener('change', resize)
      dialog?.close()
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [onClose])
  return (
    <dialog
      id={id}
      ref={dialogRef}
      aria-label="Workspace navigation"
      data-navigation
      className="navigation-drawer"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled)',
        )
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose()
        }
      }}
    >
      <div className="flex min-h-full flex-col gap-8 p-5">
        <div className="flex items-start justify-between gap-3">
          <Brand onNavigate={onNavigate} />
          <button
            ref={closeRef}
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-control text-nav-muted hover:bg-nav-hover hover:text-nav-ink"
          >
            <Icon name="close" />
          </button>
        </div>
        <div>
          <p className="mb-3 px-3 text-xs font-semibold tracking-widest text-nav-muted">
            WORKSPACE
          </p>
          <Navigation onNavigate={onNavigate} />
        </div>
        <LocalNote />
      </div>
    </dialog>
  )
}
export function AppShell({
  children,
  page = 'Dashboard',
  compact = false,
}: {
  children: ReactNode
  page?: string
  compact?: boolean
}) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  useEffect(() => {
    document.title = `${page} · RAGVault`
  }, [page])
  const drawerId = useId()
  const closeNavigation = useCallback(() => setNavigationOpen(false), [])
  function navigateFromDrawer() {
    closeNavigation()
  }
  return (
    <div className="min-h-screen lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-surface focus:p-3"
      >
        Skip to content
      </a>
      <aside
        data-navigation
        className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-10 overflow-y-auto border-r border-nav-line bg-nav p-5 text-nav-ink lg:flex"
      >
        <Brand />
        <div>
          <p className="mb-3 px-3 text-xs font-semibold tracking-widest text-nav-muted">
            WORKSPACE
          </p>
          <Navigation />
        </div>
        <LocalNote />
      </aside>
      {navigationOpen && (
        <MobileNavigation
          id={drawerId}
          onClose={closeNavigation}
          onNavigate={navigateFromDrawer}
        />
      )}
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={navigationOpen}
            aria-controls={navigationOpen ? drawerId : undefined}
            aria-haspopup="dialog"
            onClick={() => setNavigationOpen(true)}
            className="grid size-11 shrink-0 place-items-center rounded-control border border-control-border text-ink hover:bg-canvas lg:hidden"
          >
            <Icon name="menu" />
          </button>
          <p className="text-sm text-muted">
            <span className="hidden sm:inline">
              Workspace{' '}
              <span aria-hidden="true" className="mx-3">
                /
              </span>
            </span>
            <span className="font-medium text-ink">{page}</span>
          </p>
        </div>
        <ThemeSelector />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto min-w-0 max-w-7xl px-4 sm:px-6 lg:px-10 ${compact ? 'py-5' : 'py-8 lg:py-10'}`}
      >
        {children}
      </main>
    </div>
  )
}
