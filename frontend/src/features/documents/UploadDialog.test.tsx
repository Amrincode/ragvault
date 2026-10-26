import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { UploadDialog } from './LibraryDialogs'
import * as api from '../../lib/api'
import type { Document } from '../../types/library'

vi.mock('../../lib/api', () => ({ uploadDocument: vi.fn() }))
const groups = [
  {
    id: 'garden',
    name: 'Garden research',
    document_count: 0,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'notes',
    name: 'Notes',
    document_count: 0,
    created_at: '',
    updated_at: '',
  },
]
function mount() {
  const uploaded = vi.fn()
  const close = vi.fn()
  render(
    <UploadDialog
      collections={groups}
      selectedId="notes"
      config={{ max_upload_bytes: 1024, max_pdf_pages: 10 }}
      onUploaded={uploaded}
      onClose={close}
    />,
  )
  return { uploaded, close }
}
beforeEach(() => vi.resetAllMocks())
it('shows real selected-file metadata, destination and restrictions with no fake percentage', async () => {
  mount()
  expect(screen.getByRole('combobox', { name: 'Collection' })).toHaveValue(
    'notes',
  )
  await userEvent.upload(
    screen.getByLabelText('Choose PDF'),
    new File(['%PDF'], 'Garden.pdf', { type: 'application/pdf' }),
  )
  expect(screen.getByText('Garden.pdf')).toBeInTheDocument()
  expect(screen.getByText('1 KB · Destination: Notes')).toBeInTheDocument()
  expect(screen.getByText(/One unencrypted PDF/)).toHaveTextContent('10 pages')
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument()
})
it.each([
  ['notes.txt', 'text/plain', 'Choose a PDF file'],
  ['huge.pdf', 'application/pdf', 'PDF exceeds'],
])(
  'rejects an invalid choice %s before transmission',
  async (name, type, message) => {
    mount()
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(
      screen.getByLabelText('Choose PDF'),
      new File(['x'.repeat(name === 'huge.pdf' ? 1025 : 4)], name, { type }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Upload PDF',
      }),
    ).toBeDisabled()
    expect(api.uploadDocument).not.toHaveBeenCalled()
  },
)
it('rejects multiple dropped files and permits a later valid choice', async () => {
  mount()
  const input = screen.getByLabelText('Choose PDF')
  const zone = input.closest('div.border-dashed')!
  const file = new File(['%PDF'], 'synthetic.pdf', { type: 'application/pdf' })
  fireEvent.drop(zone, { dataTransfer: { files: [file, file] } })
  expect(screen.getByRole('alert')).toHaveTextContent('one PDF at a time')
  fireEvent.drop(zone, { dataTransfer: { files: [file] } })
  expect(screen.getByText(file.name)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('blocks duplicate submission and cancellation while a genuine upload is pending', async () => {
  const { uploaded, close } = mount()
  let finish!: (value: Document) => void
  vi.mocked(api.uploadDocument).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const file = new File(['%PDF'], 'synthetic.pdf', { type: 'application/pdf' })
  await userEvent.upload(screen.getByLabelText('Choose PDF'), file)
  await userEvent.click(screen.getByRole('button', { name: 'Upload PDF' }))
  expect(
    screen.getByText('Uploading and validating your PDF…'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByLabelText('Choose PDF')).toBeDisabled()
  expect(screen.getByRole('combobox', { name: 'Collection' })).toBeDisabled()
  expect(api.uploadDocument).toHaveBeenCalledExactlyOnceWith('notes', file)
  await act(async () => finish({ filename: file.name } as Document))
  expect(uploaded).toHaveBeenCalledWith({ filename: file.name })
  expect(close).toHaveBeenCalledOnce()
})
it('keeps server validation failures visible and permits retry', async () => {
  mount()
  await userEvent.upload(
    screen.getByLabelText('Choose PDF'),
    new File(['%PDF'], 'invalid.pdf', { type: 'application/pdf' }),
  )
  vi.mocked(api.uploadDocument).mockRejectedValue(
    new Error('Encrypted PDFs are not supported'),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Upload PDF' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Encrypted PDFs')
  expect(screen.getByRole('button', { name: 'Upload PDF' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
})
