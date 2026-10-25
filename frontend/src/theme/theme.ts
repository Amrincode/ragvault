export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const themeStorageKey = 'ragvault.theme'
export const systemThemeQuery = '(prefers-color-scheme: dark)'

export function validPreference(value: unknown): ThemePreference {
  return value === 'dark' || value === 'system' ? value : 'light'
}

export function readPreference(): ThemePreference {
  try {
    return validPreference(localStorage.getItem(themeStorageKey))
  } catch {
    return 'light'
  }
}

export function systemIsDark() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(systemThemeQuery).matches
  )
}

export function subscribeToSystemTheme(notify: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia(systemThemeQuery)
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}
