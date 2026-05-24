'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { Capture } from '@/lib/types'

interface CaptureActionsProps {
  capture: Capture
}

export function CaptureActions({ capture }: CaptureActionsProps) {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const handleDelete = async () => {
    setDeleting(true)
    setActionError(null)
    try {
      const res = await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', path: capture.path }),
      })
      if (!res.ok) throw new Error('Delete failed')
      setDeleteOpen(false)
      router.push('/captures')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed. Check file permissions and retry.')
    } finally {
      setDeleting(false)
    }
  }

  const handleArchive = async () => {
    setArchiving(true)
    setActionError(null)
    try {
      const res = await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive', path: capture.path }),
      })
      if (!res.ok) throw new Error('Archive failed')
      router.push('/captures')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Archive failed. Check file permissions and retry.')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="space-y-2 pt-4 border-t border-zinc-800">
      {actionError && (
        <div className="rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          {actionError}
        </div>
      )}

      {/* Download */}
      <a
        href={`/api/media/${capture.path}`}
        download={capture.filename}
        className="flex min-h-11 w-full items-center gap-2 rounded px-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 sm:min-h-9"
      >
        <Download className="size-4 shrink-0" aria-hidden="true" />
        Download
      </a>

      <button
        type="button"
        onClick={handleArchive}
        disabled={archiving || capture.archived}
        className="flex min-h-11 w-full items-center gap-2 rounded px-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
      >
        <Archive className="size-4 shrink-0" aria-hidden="true" />
        {capture.archived ? 'Archived' : archiving ? 'Archiving…' : 'Archive'}
      </button>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogTrigger asChild>
          <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded px-3 text-sm text-red-400 transition-colors hover:bg-zinc-800 hover:text-red-300 sm:min-h-9">
            <Trash2 className="size-4 shrink-0" aria-hidden="true" />
            Delete
          </button>
        </DialogTrigger>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Delete capture?</DialogTitle>
            <DialogDescription className="text-zinc-400">
              This will permanently delete <span className="font-mono text-zinc-300">{capture.filename}</span>. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              className="min-h-11 border-zinc-700 text-zinc-300 hover:bg-zinc-800 sm:min-h-9"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="min-h-11 sm:min-h-9"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
