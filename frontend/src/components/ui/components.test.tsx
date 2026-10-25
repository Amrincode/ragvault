import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { EmptyState } from './EmptyState'
import { FormField } from './FormField'
import { Input } from './Input'
import { LoadingIndicator } from './LoadingIndicator'
import { StatusIndicator } from './StatusIndicator'
import { Textarea } from './Textarea'

describe('Shared controls', () => {
  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'renders the %s button variant with native semantics',
    async (variant) => {
      const click = vi.fn()
      render(
        <Button variant={variant} onClick={click}>
          Inspect
        </Button>,
      )
      const button = screen.getByRole('button', { name: 'Inspect' })
      expect(button).toHaveAttribute('data-variant', variant)
      expect(button).toHaveAttribute('type', 'button')
      await userEvent.tab()
      expect(button).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      expect(click).toHaveBeenCalledOnce()
    },
  )
  it('keeps loading and disabled buttons named, noninteractive and out of the tab order', async () => {
    const click = vi.fn()
    render(
      <>
        <Button disabled onClick={click}>
          Unavailable
        </Button>
        <Button loading onClick={click}>
          Saving
        </Button>
        <Button size="sm" variant="secondary">
          Next
        </Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Saving' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Saving' }))
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
    expect(click).not.toHaveBeenCalled()
  })
  it('preserves submit behavior when explicitly requested', async () => {
    const submit = vi.fn((event) => event.preventDefault())
    render(
      <form onSubmit={submit}>
        <Button type="submit">Save</Button>
      </form>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(submit).toHaveBeenCalledOnce()
  })
  it('associates labels, hints and validation errors while preserving native input props/ref', () => {
    const ref = createRef<HTMLInputElement>()
    render(
      <>
        <p id="external">External description</p>
        <FormField label="Title" hint="Keep it short" error="Required">
          <Input id="title" ref={ref} required aria-describedby="external" />
        </FormField>
      </>,
    )
    const input = screen.getByLabelText('Title')
    expect(input).toBe(ref.current)
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(
      'External description Keep it short Required',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
  })
  it('supports textarea multiline entry and generated label IDs', async () => {
    render(
      <FormField label="Notes">
        <Textarea />
      </FormField>,
    )
    const notes = screen.getByRole('textbox', { name: 'Notes' })
    await userEvent.type(notes, 'First{Enter}Second')
    expect(notes).toHaveValue('First\nSecond')
  })
  it('renders surfaces and status variants without relying on color alone', () => {
    render(
      <Card elevated>
        <Badge tone="warning">Needs review</Badge>
        <StatusIndicator tone="success">Ready</StatusIndicator>
        <LoadingIndicator label="Loading documents" />
      </Card>,
    )
    expect(screen.getByText('Needs review')).toHaveAttribute(
      'data-tone',
      'warning',
    )
    expect(screen.getByText('Ready')).toHaveAttribute('data-tone', 'success')
    expect(screen.getByRole('status')).toHaveTextContent('Loading documents')
  })
  it('keeps empty-state actions operational', async () => {
    const click = vi.fn()
    render(
      <EmptyState
        title="No matches"
        description="Try another query."
        action={<Button onClick={click}>Reset</Button>}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'No matches' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(click).toHaveBeenCalledOnce()
  })
})
