import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { FormField } from '../components/ui/FormField'
import { Input } from '../components/ui/Input'
import { LoadingIndicator } from '../components/ui/LoadingIndicator'
import { StatusIndicator } from '../components/ui/StatusIndicator'
import { Textarea } from '../components/ui/Textarea'

export default function DesignSystemPreview() {
  const [notice, setNotice] = useState(
    'Select a button to inspect its interaction.',
  )
  const [name, setName] = useState('Research library')
  const [notes, setNotes] = useState('A focused place for evidence and ideas.')
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState(false)
  return (
    <AppShell page="Design system">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">RAGVAULT / FOUNDATIONS</p>
          <h1 className="mt-3 text-page font-semibold">Design system</h1>
          <p className="mt-3 max-w-xl text-body text-muted">
            Shared foundations for a focused document workspace. Calm surfaces,
            clear hierarchy and considered interactions.
          </p>
        </div>
        <Badge tone="accent">Development only · 8.1</Badge>
      </div>
      <p className="mt-4 text-meta text-muted">
        Interactive component examples. Nothing on this page uploads documents,
        calls AI or saves application data.
      </p>
      <div className="mt-7 grid gap-5 xl:grid-cols-2">
        <Card>
          <h2 className="text-section font-semibold">Color & surface</h2>
          <p className="mt-1 text-meta text-muted">
            Semantic roles adapt together in both themes.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-6">
            {[
              ['Navigation', 'bg-nav'],
              ['Primary', 'bg-primary'],
              ['Canvas', 'bg-canvas'],
              ['Surface', 'bg-surface'],
              ['Accent', 'bg-accent-soft'],
              ['Border', 'bg-line'],
            ].map(([label, color]) => (
              <div key={label}>
                <div
                  className={`h-14 rounded-control border border-line ${color}`}
                />
                <p className="mt-2 text-meta text-muted">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-control border border-line bg-canvas p-4">
            <p className="font-medium">Subtle by default.</p>
            <p className="mt-1 text-sm text-muted">
              Depth comes from spacing and borders, with restrained teal for
              actions.
            </p>
          </div>
        </Card>
        <Card>
          <h2 className="text-section font-semibold">Typography</h2>
          <p className="mt-6 text-page font-semibold">Clarity comes first.</p>
          <p className="mt-4 text-section font-semibold">
            A clear section heading
          </p>
          <p className="mt-3 text-body">
            Body text balances comfortable reading with a compact workspace.
          </p>
          <p className="mt-3 text-meta text-muted">
            Metadata · 13 px / 1.5 · Inter with system fallbacks
          </p>
        </Card>
        <Card>
          <h2 className="text-section font-semibold">Actions</h2>
          <p className="mt-1 text-meta text-muted">
            One primary action. Quiet alternatives. Explicit destructive intent.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              onClick={() =>
                setNotice(
                  'Primary action selected. This demonstration saves no data.',
                )
              }
            >
              <Icon name="plus" className="size-4" />
              Primary action
            </Button>
            <Button variant="secondary" onClick={() => setDialog(true)}>
              Open dialog
            </Button>
            <Button
              variant="ghost"
              onClick={() => setNotice('Ghost action selected.')}
            >
              Quiet action
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                setNotice('Danger variant selected. No data was deleted.')
              }
            >
              Danger example
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setNotice('Small button selected.')}
            >
              Small
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => setNotice('Large button selected.')}
            >
              Large
            </Button>
            <Button disabled>Disabled</Button>
            <Button loading>Loading example</Button>
          </div>
          <p role="status" className="mt-5 text-meta text-muted">
            {notice}
          </p>
        </Card>
        <Card>
          <h2 className="text-section font-semibold">Badges & status</h2>
          <p className="mt-1 text-meta text-muted">
            Text carries meaning. Color reinforces it.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="accent">Indexed</Badge>
            <Badge tone="success">Ready</Badge>
            <Badge tone="warning">Needs review</Badge>
            <Badge tone="danger">Failed</Badge>
          </div>
          <div className="mt-6 flex flex-wrap gap-5">
            <StatusIndicator tone="success">Ready to search</StatusIndicator>
            <StatusIndicator tone="warning">Review required</StatusIndicator>
            <StatusIndicator tone="danger">
              Connection unavailable
            </StatusIndicator>
          </div>
          <div className="mt-6 border-t border-line pt-5">
            <LoadingIndicator label="Loading indicator example" />
          </div>
        </Card>
        <Card elevated>
          <h2 className="text-section font-semibold">Form controls</h2>
          <p className="mt-1 text-meta text-muted">
            Preview form · validates locally, never saves.
          </p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim().length < 3) setError('Use at least 3 characters.')
              else {
                setError('')
                setNotice(
                  `Preview validated for ${name.trim()}. No application data was saved.`,
                )
              }
            }}
          >
            <FormField
              label="Workspace name"
              hint="A short, descriptive name."
              error={error}
            >
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField
              label="Notes"
              hint="Plain text, no remote service required."
            >
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </FormField>
            <FormField
              label="Disabled control"
              hint="Unavailable controls retain readable labels."
            >
              <Input disabled value="Read-only example" />
            </FormField>
            <div className="flex flex-wrap gap-3">
              <Button type="submit">Validate preview</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setName('')
                  setNotes('')
                  setError('')
                }}
              >
                Clear fields
              </Button>
            </div>
          </form>
        </Card>
        <Card>
          <h2 className="text-section font-semibold">Empty state</h2>
          <p className="mt-1 text-meta text-muted">
            A helpful explanation and a working next step.
          </p>
          <EmptyState
            title="Room for your next idea"
            description="Empty states explain what belongs here and what to do next. This is a component example."
            icon={<Icon name="documents" className="size-6" />}
            action={
              <Button
                variant="secondary"
                onClick={() =>
                  setNotice('Empty-state example action selected.')
                }
              >
                Try example action
              </Button>
            }
          />
          <div className="border-t border-line pt-5">
            <p className="text-meta text-muted">
              Keyboard: Tab to move, Enter to activate. Focus rings stay
              visible. Reduced-motion preferences are respected.
            </p>
          </div>
        </Card>
      </div>
      {dialog && (
        <Dialog title="Dialog foundation" onClose={() => setDialog(false)}>
          <p className="text-sm text-muted">
            Existing native dialog behavior is preserved: focus stays inside,
            Escape closes it, and focus returns to the trigger.
          </p>
          <div className="mt-5 flex justify-end">
            <Button onClick={() => setDialog(false)}>Done</Button>
          </div>
        </Dialog>
      )}
    </AppShell>
  )
}
