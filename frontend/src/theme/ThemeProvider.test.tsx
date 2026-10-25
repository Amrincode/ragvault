import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from './ThemeProvider'
import { ThemeSelector } from './ThemeSelector'
import { themeStorageKey } from './theme'

let media: MediaQueryList
let subscribers: Set<() => void>
function preferenceView() {
  return render(
    <ThemeProvider>
      <ThemeSelector />
    </ThemeProvider>,
  )
}
function systemChange(dark: boolean) {
  Object.defineProperty(media, 'matches', { configurable: true, value: dark })
  act(() => subscribers.forEach((notify) => notify()))
}
beforeEach(() => {
  localStorage.clear()
  subscribers = new Set()
  media = {
    matches: false,
    addEventListener: vi.fn((_event, notify) =>
      subscribers.add(notify as () => void),
    ),
    removeEventListener: vi.fn((_event, notify) =>
      subscribers.delete(notify as () => void),
    ),
  } as unknown as MediaQueryList
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.colorScheme = ''
})

describe('Theme foundation', () => {
  it('starts light even if the system is dark until System is selected', () => {
    systemChange(true)
    preferenceView()
    expect(screen.getByLabelText('Theme')).toHaveValue('light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })
  it('selects and persists Dark and restores it on remount', async () => {
    const view = preferenceView()
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(localStorage.getItem(themeStorageKey)).toBe('dark')
    view.unmount()
    preferenceView()
    expect(screen.getByLabelText('Theme')).toHaveValue('dark')
  })
  it('reacts to live system changes only in System mode and unsubscribes', async () => {
    const view = preferenceView()
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'system')
    systemChange(true)
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem(themeStorageKey)).toBe('system')
    systemChange(false)
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'dark')
    systemChange(false)
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    view.unmount()
    expect(subscribers.size).toBe(0)
  })
  it('synchronizes stored choices and a storage reset across tabs', () => {
    preferenceView()
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: themeStorageKey, newValue: 'dark' }),
      ),
    )
    expect(screen.getByLabelText('Theme')).toHaveValue('dark')
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: null, newValue: null }),
      ),
    )
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })
  it('rejects unknown stored preferences', () => {
    localStorage.setItem(themeStorageKey, 'invented-value')
    preferenceView()
    expect(screen.getByLabelText('Theme')).toHaveValue('light')
  })
  it('keeps an in-memory choice usable when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    preferenceView()
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })
  it('supports keyboard selection through the native theme control', async () => {
    preferenceView()
    await userEvent.tab()
    expect(screen.getByLabelText('Theme')).toHaveFocus()
    // Native select semantics, rather than custom radio/menu keyboard handling.
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeEnabled()
  })
})
