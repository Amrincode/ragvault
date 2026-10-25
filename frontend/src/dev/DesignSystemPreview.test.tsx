import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import DesignSystemPreview from './DesignSystemPreview'

it('provides working local examples, validation and an existing native dialog', async () => {
  render(
    <MemoryRouter>
      <ThemeProvider>
        <DesignSystemPreview />
      </ThemeProvider>
    </MemoryRouter>,
  )
  expect(
    screen.getByText(/Nothing on this page uploads documents/),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Clear fields' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Validate preview' }),
  )
  expect(screen.getByLabelText('Workspace name')).toHaveAttribute(
    'aria-invalid',
    'true',
  )
  await userEvent.type(
    screen.getByLabelText('Workspace name'),
    'Example library',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Validate preview' }),
  )
  expect(
    screen.getByText(/Preview validated for Example library/),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Open dialog' }))
  expect(
    screen.getByRole('dialog', { name: 'Dialog foundation' }),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  await userEvent.selectOptions(screen.getByLabelText('Theme'), 'dark')
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
})
