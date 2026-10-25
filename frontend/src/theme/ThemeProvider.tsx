import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { ThemeContext } from './theme-context'
import {
  readPreference,
  subscribeToSystemTheme,
  systemIsDark,
  themeStorageKey,
  validPreference,
} from './theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readPreference)
  const systemDark = useSyncExternalStore(
    subscribeToSystemTheme,
    systemIsDark,
    () => false,
  )
  const resolvedTheme =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
    try {
      localStorage.setItem(themeStorageKey, preference)
    } catch {
      // The in-memory selection still works when browser storage is unavailable.
    }
  }, [preference, resolvedTheme])

  useEffect(() => {
    function syncPreference(event: StorageEvent) {
      if (event.key === themeStorageKey || event.key === null)
        setPreference(validPreference(event.newValue))
    }
    window.addEventListener('storage', syncPreference)
    return () => window.removeEventListener('storage', syncPreference)
  }, [])

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme],
  )
  return <ThemeContext value={value}>{children}</ThemeContext>
}
