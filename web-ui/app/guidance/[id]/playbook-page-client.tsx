'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Playbook } from '@/lib/types'
import { PlaybookEditor } from '@/components/playbook-editor'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface PlaybookPageClientProps {
  playbook: Playbook
  isNew: boolean
}

export function PlaybookPageClient({ playbook: initial, isNew }: PlaybookPageClientProps) {
  const router = useRouter()
  const [playbook, setPlaybook] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleSave(updated: Playbook) {
    setSaving(true)
    setSaveError(null)
    try {
      let res: Response
      if (isNew) {
        res = await fetch('/api/playbooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        })
      } else {
        res = await fetch(`/api/playbooks/${updated.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        })
      }

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setSaveError(data.error ?? 'Save failed')
        return
      }

      const saved = await res.json() as Playbook
      setPlaybook(saved)
      showToast('Playbook saved')
      if (isNew) {
        router.replace(`/guidance/${saved.id}`)
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/playbooks/${playbook.id}`, { method: 'DELETE' })
      router.push('/guidance')
    } catch (err) {
      console.error('[delete playbook]', err)
    } finally {
      setDeleting(false)
    }
  }

  function handleRun() {
    showToast('Playbook execution coming soon')
  }

  return (
    <div className="relative space-y-4">
      {/* Action row */}
      <div className="flex items-center justify-between gap-3">
        <div />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRun}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            <svg className="w-3.5 h-3.5 mr-1.5" fill="currentColor" viewBox="0 0 8 10">
              <path d="M0 0l8 5-8 5V0z" />
            </svg>
            Run
          </Button>
          {!isNew && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              className="border-zinc-700 text-red-500 hover:bg-zinc-800 hover:text-red-400"
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="bg-red-950/30 border border-red-700/40 rounded-lg px-3 py-2 text-sm text-red-300">
          {saveError}
        </div>
      )}

      <PlaybookEditor
        playbook={playbook}
        onSave={handleSave}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm px-4 py-2.5 rounded-lg shadow-xl z-50 animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-zinc-50">Delete playbook?</DialogTitle>
            <DialogDescription className="text-zinc-400">
              &ldquo;{playbook.name}&rdquo; will be permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white border-0"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
