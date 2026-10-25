import {
  cloneElement,
  useId,
  type AriaAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'

type ControlProps = {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: AriaAttributes['aria-invalid']
}

export function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode
  hint?: string
  error?: string
  children: ReactElement<ControlProps>
}) {
  const generated = useId()
  const id = children.props.id || generated
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [
      children.props['aria-describedby'],
      hint ? hintId : '',
      error ? errorId : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="form-label">
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })}
      {hint && (
        <p id={hintId} className="text-meta text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
