import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '../../lib/api'
import type { Document } from '../../types/library'
import { IndexingActions } from './IndexingActions'

vi.mock('../../lib/api', () => ({ indexDocument: vi.fn() }))
const document: Document = {
  id: 'doc',
  collection_id: 'collection',
  filename: 'paper.pdf',
  file_size: 100,
  mime_type: 'application/pdf',
  checksum: 'a'.repeat(64),
  processing_status: 'processed',
  created_at: '2026-10-25T00:00:00Z',
  updated_at: '2026-10-25T00:00:00Z',
}
beforeEach(() => vi.clearAllMocks())
it('indexes existing processed chunks and refreshes', async () => {
  vi.mocked(api.indexDocument).mockResolvedValue({
    ...document,
    indexing_status: 'indexed',
  })
  const changed = vi.fn()
  render(<IndexingActions document={document} onChanged={changed} />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Index for search paper.pdf' }),
  )
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(api.indexDocument).toHaveBeenCalledWith('doc')
})
it('supports retry and displays safe errors', async () => {
  vi.mocked(api.indexDocument).mockRejectedValue(
    new Error('Check Ollama and retry'),
  )
  render(
    <IndexingActions
      document={{ ...document, indexing_status: 'failed' }}
      onChanged={vi.fn()}
    />,
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry indexing paper.pdf' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Check Ollama and retry',
  )
})
it('does not offer indexing before successful text processing', () => {
  render(
    <IndexingActions
      document={{ ...document, processing_status: 'no_text' }}
      onChanged={vi.fn()}
    />,
  )
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
