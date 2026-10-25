/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const bootstrap = readFileSync('public/theme-init.js', 'utf8')

describe('Early theme initialization', () => {
  it.each([
    [null, true, 'light'],
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['unknown', true, 'light'],
  ])(
    'applies stored %s with system dark=%s before React',
    (preference, dark, expected) => {
      const root = {
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
      }
      runInNewContext(bootstrap, {
        document: { documentElement: root },
        localStorage: { getItem: () => preference },
        matchMedia: () => ({ matches: dark }),
      })
      expect(root.dataset.theme).toBe(expected)
      expect(root.style.colorScheme).toBe(expected)
    },
  )
  it('uses a safe default with inaccessible storage and no matchMedia', () => {
    const root = {
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
    }
    runInNewContext(bootstrap, {
      document: { documentElement: root },
      localStorage: {
        getItem: () => {
          throw new Error('blocked')
        },
      },
    })
    expect(root.dataset.theme).toBe('light')
  })
  it('loads the initialization script before the application module', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html.indexOf('src="/theme-init.js"')).toBeLessThan(
      html.indexOf('src="/src/main.tsx"'),
    )
  })
})
