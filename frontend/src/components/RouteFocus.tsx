import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'

// Wait for the destination to commit before focusing it; skip the initial page load.
export function RouteFocus() {
  const { key } = useLocation()
  const previous = useRef(key)
  useEffect(() => {
    if (previous.current !== key) document.getElementById('main')?.focus()
    previous.current = key
  }, [key])
  return null
}
