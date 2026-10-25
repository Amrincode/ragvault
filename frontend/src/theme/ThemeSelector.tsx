import { useId } from 'react'
import { useTheme } from './theme-context'
import { validPreference } from './theme'
import { Icon } from '../components/Icon'

export function ThemeSelector() {
  const theme = useTheme()
  const id = useId()
  if (!theme) return null
  return (
    <div className="flex items-center gap-2 rounded-control border border-line bg-canvas px-2.5 py-1">
      <Icon name="appearance" className="hidden size-4 text-muted sm:block" />
      <label className="text-meta font-medium text-ink" htmlFor={id}>
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
