import type { CSSProperties } from 'react'

const paths = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6',
  appearance: 'M12 3a9 9 0 1 0 0 18V3Zm0 0a9 9 0 0 1 0 18',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  vault: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm-8 4.5 8 4.5 8-4.5M12 12v9',
  dashboard: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  documents:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h5',
  chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5ZM8 12h8',
  arrow: 'M7 17 17 7M7 7h10v10',
  refresh:
    'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 17.9 17',
  server:
    'M4 3h16v7H4V3Zm0 11h16v7H4v-7ZM7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6',
  database:
    'M20 6c0 2.2-3.6 4-8 4s-8-1.8-8-4 3.6-4 8-4 8 1.8 8 4Zm0 0v12c0 2.2-3.6 4-8 4s-8-1.8-8-4V6m0 6c0 2.2 3.6 4 8 4s8-1.8 8-4',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  check: 'm5 12 4 4L19 6',
  lock: 'M5 10h14v11H5V10Zm3 0V6a4 4 0 0 1 8 0v4m-4 5v2',
} as const

export type IconName = keyof typeof paths

export function Icon({
  name,
  className = '',
  style,
}: {
  name: IconName
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-5 shrink-0 ${className}`}
      style={style}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
