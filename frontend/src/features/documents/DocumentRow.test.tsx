import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { DocumentRow } from './DocumentRow'
import type { Document } from '../../types/library'

vi.mock('../../lib/api', () => ({
  processDocument: vi.fn(),
  indexDocument: vi.fn(),
  documentDownloadUrl: (id: string) =>
    `/api/documents/${id}/file?download=true`,
}))
const doc: Document = {
  id: 'synthetic',
  filename: 'Garden.pdf',
  collection_id: 'garden',
  file_size: 2048,
  mime_type: 'application/pdf',
  checksum: 'a'.repeat(64),
  processing_status: 'uploaded',
  indexing_status: 'not_indexed',
  created_at: '2026-10-26T00:00:00Z',
  updated_at: '2026-10-26T00:00:00Z',
}
function mount(document = doc) {
  render(
    <ul>
      <DocumentRow
        document={document}
        collection="Garden research"
        onPreview={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onChanged={vi.fn()}
      />
    </ul>,
  )
}
it.each([
  ['uploaded', 'Uploaded'],
  ['processing', 'Processing'],
  ['processed', 'Processed'],
  ['failed', 'Processing failed'],
  ['no_text', 'No extractable text'],
] as const)(
  'shows the real text state %s independently of indexing',
  (state, label) => {
    mount({ ...doc, processing_status: state })
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('Not indexed')).toBeInTheDocument()
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  },
)
it.each([
  ['not_indexed', 'Not indexed'],
  ['indexing', 'Indexing'],
  ['indexed', 'Indexed'],
  ['failed', 'Indexing failed'],
] as const)('shows the real search state %s', (state, label) => {
  mount({ ...doc, processing_status: 'processed', indexing_status: state })
  expect(screen.getByText('Processed')).toBeInTheDocument()
  expect(screen.getByText(label)).toBeInTheDocument()
})
it('retains full names and hides technical metadata behind a native disclosure', async () => {
  const long = 'long-name-'.repeat(30) + '.pdf'
  mount({
    ...doc,
    filename: long,
    processing_status: 'processed',
    chunk_count: 3,
    page_count: 2,
  })
  expect(screen.getByRole('heading', { name: long })).toHaveClass(
    '[overflow-wrap:anywhere]',
  )
  expect(screen.getByRole('button', { name: `Preview ${long}` })).toBeEnabled()
  expect(
    screen.getByRole('link', { name: `Download ${long}` }),
  ).toHaveAttribute('href', '/api/documents/synthetic/file?download=true')
  expect(screen.getByText(doc.checksum)).not.toBeVisible()
  await userEvent.click(screen.getByLabelText(`Document details for ${long}`))
  expect(screen.getByText(doc.checksum)).toBeVisible()
  expect(screen.getByText('3 chunks · 2 pages')).toBeVisible()
  expect(screen.getByRole('button', { name: `Delete ${long}` })).toBeEnabled()
})
it('does not hide failed processing or indexing recovery behind the disclosure', () => {
  mount({
    ...doc,
    processing_status: 'processed',
    indexing_status: 'failed',
    indexing_error: 'Check the local embedding runtime',
  })
  expect(
    screen.getByRole('button', { name: 'Retry indexing Garden.pdf' }),
  ).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('embedding runtime')
  expect(
    screen.getByLabelText('Document details for Garden.pdf'),
  ).not.toHaveAttribute('open')
})
