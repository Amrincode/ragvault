import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { AppShell } from './AppShell'
import { RouteFocus } from './RouteFocus'
import { ThemeProvider } from '../theme/ThemeProvider'

let media: MediaQueryList
let resize: (() => void) | undefined
function Content() {
  const location = useLocation()
  return (
    <AppShell>
      <h1>Current page: {location.pathname}</h1>
      <textarea aria-label="Existing composer" />
    </AppShell>
  )
}
function mount(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <RouteFocus />
        <Content />
      </ThemeProvider>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  localStorage.clear()
  resize = undefined
  media = {
    matches: false,
    addEventListener: vi.fn((_name, handler) => {
      resize = handler as () => void
    }),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.body.style.overflow = ''
})
describe('shared workspace navigation', () => {
  it('focuses a newly mounted route after the old shell and drawer unmount', async () => {
    function Home() {
      return (
        <AppShell>
          <h1>Workspace home</h1>
        </AppShell>
      )
    }
    function Library() {
      return (
        <AppShell page="Documents">
          <h1>Existing library</h1>
        </AppShell>
      )
    }
    render(
      <MemoryRouter>
        <RouteFocus />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/documents" element={<Library />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('main')).not.toHaveFocus()
    expect(document.title).toBe('Dashboard · RAGVault')
    await userEvent.click(
      screen.getByRole('button', { name: 'Open navigation' }),
    )
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('link', {
        name: 'Documents',
      }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Existing library' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
    expect(document.title).toBe('Documents · RAGVault')
    expect(document.body.style.overflow).toBe('')
  })
  it.each([
    ['/', 'Dashboard'],
    ['/documents', 'Documents'],
    ['/search', 'Semantic search'],
    ['/chat', 'Document chat'],
  ])('marks only the current route %s active', (path, label) => {
    mount(path)
    const navigation = screen.getByRole('navigation', {
      name: 'Main navigation',
    })
    expect(
      within(navigation).getByRole('link', { name: label }),
    ).toHaveAttribute('aria-current', 'page')
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/', '/documents', '/search', '/chat'])
    expect(
      screen.getByRole('link', { name: 'Skip to content' }),
    ).toHaveAttribute('href', '#main')
    expect(screen.queryByText(/milestone|v0\.7\.0/i)).not.toBeInTheDocument()
  })
  it('opens from the keyboard, focuses Close, handles Escape and returns trigger focus', async () => {
    mount()
    const toggle = screen.getByRole('button', { name: 'Open navigation' })
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    const drawer = screen.getByRole('dialog', { name: 'Workspace navigation' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle.getAttribute('aria-controls')).toBe(drawer.id)
    expect(
      within(drawer).getByRole('button', { name: 'Close navigation' }),
    ).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    const first = within(drawer).getByRole('link', { name: /RAGVault/ })
    const last = within(drawer).getByRole('link', { name: 'Document chat' })
    first.focus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent(drawer, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.body.style.overflow).toBe('')
  })
  it('closes on route selection and moves focus to the usable page content', async () => {
    mount()
    await userEvent.click(
      screen.getByRole('button', { name: 'Open navigation' }),
    )
    const drawer = screen.getByRole('dialog')
    await userEvent.click(
      within(drawer).getByRole('link', { name: 'Document chat' }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Current page: /chat' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
    expect(
      screen.getByRole('textbox', { name: 'Existing composer' }),
    ).toBeEnabled()
  })
  it('closes on its close control and on crossing to desktop, releasing body scroll', async () => {
    const view = mount()
    const toggle = screen.getByRole('button', { name: 'Open navigation' })
    await userEvent.click(toggle)
    await userEvent.click(
      screen.getByRole('button', { name: 'Close navigation' }),
    )
    expect(toggle).toHaveFocus()
    await userEvent.click(toggle)
    Object.defineProperty(media, 'matches', { value: true })
    act(() => resize?.())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    Object.defineProperty(media, 'matches', {
      value: false,
      configurable: true,
    })
    await userEvent.click(toggle)
    view.unmount()
    expect(document.body.style.overflow).toBe('')
  })
  it('retains accessible persisted Light/Dark/System controls in the shell', async () => {
    mount()
    const theme = screen.getByRole('combobox', { name: 'Theme' })
    await userEvent.selectOptions(theme, 'dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem('ragvault.theme')).toBe('dark')
    await userEvent.selectOptions(theme, 'system')
    expect(theme).toHaveValue('system')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    await userEvent.selectOptions(theme, 'light')
    expect(localStorage.getItem('ragvault.theme')).toBe('light')
  })
})
