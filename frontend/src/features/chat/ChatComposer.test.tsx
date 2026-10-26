import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChatComposer } from './ChatComposer'

function Composer({
  send,
  single = false,
}: {
  send: (question: string, topK: number) => void
  single?: boolean
}) {
  const [question, setQuestion] = useState('')
  const [topK, setTopK] = useState(5)
  return (
    <ChatComposer
      single={single}
      question={question}
      onQuestion={setQuestion}
      topK={topK}
      onTopK={setTopK}
      onSend={() => send(question, topK)}
      disabled={false}
      busy={false}
    />
  )
}
describe('Question composer', () => {
  it.each([false, true])(
    'uses native keyboard and multiline behavior in single mode=%s',
    async (single) => {
      const send = vi.fn()
      render(<Composer send={send} single={single} />)
      const input = screen.getByLabelText('Your question')
      await userEvent.type(
        input,
        'First line{Shift>}{Enter}{/Shift}Second line',
      )
      expect(send).not.toHaveBeenCalled()
      expect(input).toHaveValue('First line\nSecond line')
      await userEvent.keyboard('{Enter}')
      expect(send).toHaveBeenCalledExactlyOnceWith('First line\nSecond line', 5)
    },
  )
  it('does not submit Enter during IME composition', () => {
    const send = vi.fn()
    render(<Composer send={send} />)
    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: 'A composed question' },
    })
    fireEvent.keyDown(screen.getByLabelText('Your question'), {
      key: 'Enter',
      isComposing: true,
    })
    expect(send).not.toHaveBeenCalled()
  })
  it('keeps top-K accessible with the same limits and sends the selected value', async () => {
    const send = vi.fn()
    render(<Composer send={send} />)
    await userEvent.click(
      screen.getByLabelText('Retrieval options · 5 passages'),
    )
    const count = screen.getByRole('spinbutton', {
      name: 'Passages to retrieve',
    })
    expect(count).toHaveAttribute('min', '1')
    expect(count).toHaveAttribute('max', '20')
    fireEvent.change(count, { target: { value: '10' } })
    await userEvent.type(
      screen.getByLabelText('Your question'),
      'A focused question',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }))
    expect(send).toHaveBeenCalledExactlyOnceWith('A focused question', 10)
  })
  it('blocks an out-of-range top-K and blank questions', async () => {
    const send = vi.fn()
    render(<Composer send={send} />)
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
    await userEvent.click(
      screen.getByLabelText('Retrieval options · 5 passages'),
    )
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '21' },
    })
    await userEvent.type(
      screen.getByLabelText('Your question'),
      'A focused question',
    )
    await userEvent.keyboard('{Enter}')
    expect(send).not.toHaveBeenCalled()
  })
  it('exposes recovery separately and never resubmits a draft as a new request', async () => {
    const recover = vi.fn(),
      send = vi.fn()
    render(
      <ChatComposer
        question="Retained question"
        onQuestion={vi.fn()}
        topK={5}
        onTopK={vi.fn()}
        onSend={send}
        disabled
        busy={false}
        recovery={recover}
      />,
    )
    expect(screen.getByLabelText('Your question')).toHaveValue(
      'Retained question',
    )
    expect(screen.getByLabelText('Your question')).toBeDisabled()
    await userEvent.click(
      screen.getByRole('button', { name: /Check submission/ }),
    )
    expect(recover).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
  })
})
