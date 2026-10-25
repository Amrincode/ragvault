import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

it('focuses the first form control and returns focus to the keyboard trigger', async () => {
  function Example() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open example</button>
        {open && (
          <Dialog title="Example" onClose={() => setOpen(false)}>
            <label>
              Name
              <input />
            </label>
          </Dialog>
        )}
      </>
    )
  }
  render(<Example />)
  await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByLabelText('Name')).toHaveFocus()
  await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
  expect(screen.getByRole('button', { name: 'Open example' })).toHaveFocus()
})

it('uses a close control when no field exists and keeps busy dialogs from cancelling', () => {
  const close = vi.fn()
  const view = render(
    <Dialog title="Example" onClose={close}>
      Content
    </Dialog>,
  )
  expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus()
  view.rerender(
    <Dialog title="Example" onClose={close} busy>
      Content
    </Dialog>,
  )
  fireEvent(
    screen.getByRole('dialog'),
    new Event('cancel', { cancelable: true }),
  )
  expect(close).not.toHaveBeenCalled()
  view.rerender(
    <Dialog title="Example" onClose={close}>
      Content
    </Dialog>,
  )
  fireEvent(
    screen.getByRole('dialog'),
    new Event('cancel', { cancelable: true }),
  )
  expect(close).toHaveBeenCalledOnce()
})
