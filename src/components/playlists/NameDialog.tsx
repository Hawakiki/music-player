import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface NameFormProps {
  initialName: string
  confirmLabel: string
  onSubmit: (name: string) => void
  onCancel: () => void
}

function NameForm({ initialName, confirmLabel, onSubmit, onCancel }: NameFormProps) {
  const [name, setName] = useState(initialName)
  const trimmed = name.trim()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <input
        autoFocus
        aria-label="이름"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="h-9 w-full rounded-lg bg-raised px-3 outline-none focus-visible:outline-2 focus-visible:outline-ring"
      />
      <DialogFooter>
        <Button type="button" variant="ghost" size="lg" className="px-3" onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" size="lg" className="px-3" disabled={!trimmed}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface NameDialogProps {
  open: boolean
  title: string
  initialName?: string
  confirmLabel: string
  onSubmit: (name: string) => void
  onClose: () => void
}

export function NameDialog({ open, title, initialName = '', confirmLabel, onSubmit, onClose }: NameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {open && (
          <NameForm initialName={initialName} confirmLabel={confirmLabel} onSubmit={onSubmit} onCancel={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}
