import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Keep PDF fonts, character maps, and codecs local; never depend on a CDN.
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  const source = fileURLToPath(
    new URL(`../node_modules/pdfjs-dist/${directory}`, import.meta.url),
  )
  const destination = fileURLToPath(
    new URL(`../public/pdfjs/${directory}`, import.meta.url),
  )
  mkdirSync(destination, { recursive: true })
  cpSync(source, destination, { recursive: true })
}
