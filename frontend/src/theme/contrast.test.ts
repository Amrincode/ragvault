/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles.css', 'utf8')
const lightBlock = css.match(/:root\s*\{([^}]+)\}/)![1]
const darkBlock = css.match(/:root\[data-theme='dark'\]\s*\{([^}]+)\}/)![1]
function tokens(block: string) {
  return Object.fromEntries(
    [...block.matchAll(/--ds-([\w-]+):\s*(#[a-f0-9]{6})/g)].map((match) => [
      match[1],
      match[2],
    ]),
  )
}
function luminance(color: string) {
  const channels = [1, 3, 5]
    .map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
function ratio(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return (values[1] + 0.05) / (values[0] + 0.05)
}

const textPairs = [
  ['ink', 'canvas'],
  ['ink', 'surface'],
  ['ink', 'elevated'],
  ['ink', 'field'],
  ['muted', 'canvas'],
  ['muted', 'surface'],
  ['muted', 'elevated'],
  ['muted', 'field'],
  ['muted', 'accent-soft'],
  ['ink', 'accent-soft'],
  ['accent', 'canvas'],
  ['accent', 'surface'],
  ['accent', 'accent-soft'],
  ['success', 'success-soft'],
  ['warning', 'warning-soft'],
  ['danger', 'danger-soft'],
  ['on-primary', 'primary'],
  ['on-primary', 'primary-hover'],
  ['on-danger', 'danger-action'],
  ['on-danger', 'danger-hover'],
  ['nav-ink', 'nav'],
  ['nav-muted', 'nav'],
  ['nav-muted', 'nav-selected'],
  ['nav-accent', 'nav'],
  ['disabled-ink', 'disabled'],
]
const nonTextPairs = [
  ['control-border', 'field'],
  ['control-border', 'surface'],
  ['control-border', 'canvas'],
  ['danger-border', 'field'],
  ['focus', 'surface'],
  ['focus', 'canvas'],
  ['focus', 'elevated'],
  ['nav-focus', 'nav'],
  ['nav-focus', 'nav-selected'],
  ['nav-accent', 'nav-selected'],
  ['nav-accent', 'nav'],
]

for (const [name, block] of [
  ['light', lightBlock],
  ['dark', darkBlock],
]) {
  describe(`${name} semantic contrast`, () => {
    const values = tokens(block)
    it.each(textPairs)(
      '%s on %s meets 4.5:1 for normal text',
      (foreground, background) => {
        expect(
          ratio(values[foreground], values[background]),
        ).toBeGreaterThanOrEqual(4.5)
      },
    )
    it.each(nonTextPairs)(
      '%s against %s meets 3:1 for control/focus boundaries',
      (foreground, background) => {
        expect(
          ratio(values[foreground], values[background]),
        ).toBeGreaterThanOrEqual(3)
      },
    )
  })
}
