import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import { Icon } from './Icon'
import { ThemeSelector } from '../theme/ThemeSelector'

export function AppShell({
  children,
  page = 'Overview',
  compact = false,
}: {
  children: ReactNode
  page?: string
  compact?: boolean
}) {
  return (
    <div className="min-h-screen lg:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-surface focus:p-3"
      >
        Skip to content
      </a>
      <aside
        data-navigation
        className="flex flex-col bg-nav text-nav-ink lg:fixed lg:inset-y-0 lg:left-0 lg:w-60"
      >
        <Link
          to="/"
          className="flex items-center gap-3 px-6 py-7 text-xl font-semibold tracking-tight"
        >
          <span className="grid size-9 place-items-center rounded-xl border border-nav-line bg-nav-hover text-nav-accent">
            <Icon name="vault" className="size-6" />
          </span>
          RAGVault<span className="sr-only"> home</span>
        </Link>
        <div className="px-4 pb-5 lg:mt-7">
          <p className="mb-3 hidden px-3 text-xs font-semibold tracking-[0.14em] text-nav-muted lg:block">
            WORKSPACE
          </p>
          <nav
            aria-label="Main navigation"
            className="flex flex-wrap gap-1 lg:flex-col"
          >
            <NavLink
              end
              to="/"
              className={({ isActive }) =>
                `nav-item ${isActive ? 'bg-nav-selected text-nav-ink' : 'text-nav-muted hover:bg-nav-hover hover:text-nav-ink'}`
              }
            >
              <Icon name="dashboard" />
              Overview
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                `nav-item ${isActive ? 'bg-nav-selected text-nav-ink' : 'text-nav-muted hover:bg-nav-hover hover:text-nav-ink'}`
              }
              to="/documents"
            >
              <Icon name="documents" />
              Documents
            </NavLink>
            <NavLink
              to="/search"
              className={({ isActive }) =>
                `nav-item ${isActive ? 'bg-nav-selected text-nav-ink' : 'text-nav-muted hover:bg-nav-hover hover:text-nav-ink'}`
              }
            >
              <Icon name="search" />
              Semantic search
            </NavLink>
            <NavLink
              to="/chat"
              className={({ isActive }) =>
                `nav-item ${isActive ? 'bg-nav-selected text-nav-ink' : 'text-nav-muted hover:bg-nav-hover hover:text-nav-ink'}`
              }
            >
              <Icon name="chat" />
              Document chat
            </NavLink>
          </nav>
        </div>
        <div className="mx-5 mt-auto hidden border-t border-nav-line py-6 lg:block">
          <div className="flex items-center gap-2 text-meta text-nav-accent">
            <Icon name="lock" className="size-3.5" />
            Local-first by design
          </div>
          <p className="mt-2 text-meta leading-5 text-nav-muted">
            Built for your documents.
            <br />
            Running on your machine.
          </p>
          <p className="mt-6 font-mono text-xs text-nav-muted">
            v0.7.0 · SAVED CONVERSATIONS
          </p>
        </div>
      </aside>
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-6 py-3 lg:px-10">
        <div className="text-sm text-muted">
          Workspace <span className="mx-3 text-line">/</span>
          <span className="font-medium text-ink">{page}</span>
        </div>
        <div className="flex items-center gap-4">
          <ThemeSelector />
          <span className="hidden rounded-full border border-line bg-surface px-3 py-1.5 text-meta font-medium text-muted xl:inline-flex">
            Milestone 07
          </span>
        </div>
      </header>
      <main
        id="main"
        className={`mx-auto max-w-7xl px-6 lg:px-10 ${compact ? 'py-5' : 'py-9 lg:py-11'}`}
      >
        {children}
      </main>
    </div>
  )
}
