import { useId } from 'react'
import { useTheme } from './theme-context'
import { validPreference } from './theme'

export function ThemeSelector() {
  const theme = useTheme()
  const id = useId()
  if (!theme) return null
  return (
    <div className="flex items-center gap-2">
      <label className="text-meta text-muted" htmlFor={id}>
        Theme
      </label>
      <select
        id={id}
        value={theme.preference}
        onChange={(event) =>
          theme.setPreference(validPreference(event.target.value))
        }
        className="theme-select"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </div>
  )
}
