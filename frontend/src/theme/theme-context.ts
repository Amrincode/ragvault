import { createContext, useContext } from 'react'
import type { ResolvedTheme, ThemePreference } from './theme'

export const ThemeContext = createContext<{
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
} | null>(null)

export const useTheme = () => useContext(ThemeContext)
