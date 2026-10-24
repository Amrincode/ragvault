import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import { Icon } from './Icon'

export function AppShell({
  children,
  page = 'Overview',
}: {
  children: ReactNode
  page?: string
}) {
  return (
    <div className="min-h-screen lg:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-white focus:p-3"
      >
        Skip to content
      </a>
      <aside className="flex flex-col bg-forest text-white lg:fixed lg:inset-y-0 lg:left-0 lg:w-60">
        <Link
          to="/"
          className="flex items-center gap-3 px-6 py-7 text-xl font-semibold tracking-tight"
        >
          <span className="grid size-9 place-items-center rounded-xl border border-white/20 bg-white/5 text-mint">
            <Icon name="vault" className="size-6" />
          </span>
          RAGVault<span className="sr-only"> home</span>
        </Link>
        <div className="px-4 pb-5 lg:mt-7">
          <p className="mb-3 hidden px-3 text-[10px] font-semibold tracking-[0.2em] text-white/40 lg:block">
            WORKSPACE
          </p>
          <nav aria-label="Main navigation" className="flex gap-1 lg:flex-col">
            <NavLink
              end
              to="/"
              className={({ isActive }) =>
                `nav-item ${isActive ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white'}`
              }
            >
              <Icon name="dashboard" />
              Overview
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                `nav-item ${isActive ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white'}`
              }
              to="/documents"
            >
              <Icon name="documents" />
              Documents
            </NavLink>
            <span className="nav-item text-white/45">
              <Icon name="chat" />
              Chat<span className="nav-soon">Soon</span>
            </span>
          </nav>
        </div>
        <div className="mx-5 mt-auto hidden border-t border-white/10 py-6 lg:block">
          <div className="flex items-center gap-2 text-xs text-mint">
            <Icon name="lock" className="size-3.5" />
            Local-first by design
          </div>
          <p className="mt-2 text-xs leading-5 text-white/45">
            Built for your documents.
            <br />
            Running on your machine.
          </p>
          <p className="mt-6 font-mono text-[10px] text-white/30">
            v0.2.0 · LOCAL LIBRARY
          </p>
        </div>
      </aside>
      <header className="flex h-20 items-center justify-between border-b border-line bg-white/70 px-6 lg:px-10">
        <div className="text-sm text-muted">
          Workspace <span className="mx-3 text-line">/</span>
          <span className="font-medium text-ink">{page}</span>
        </div>
        <span className="rounded-full border border-line bg-white px-3 py-1.5 text-[11px] font-medium text-muted">
          Milestone 02
        </span>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-6 py-9 lg:px-10 lg:py-11">
        {children}
      </main>
    </div>
  )
}
