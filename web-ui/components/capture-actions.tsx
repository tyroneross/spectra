'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

  const handleDelete = async () => {
    setDeleting(true)
    try {
      // TODO: Iteration 2 — wire to DELETE /api/captures/[id]
      console.log('[capture] delete', capture.id)
      setDeleteOpen(false)
      router.push('/captures')
    } finally {
      setDeleting(false)
    }
  }

  const handleArchive = async () => {
    setArchiving(true)
    try {
      // TODO: Iteration 2 — wire to POST /api/captures/[id]/archive
      console.log('[capture] archive', capture.id)
      router.push('/captures')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="space-y-2 pt-4 border-t border-zinc-800">
      {/* Download */}
      <a
        href={`/api/media/${capture.path}`}
        download={capture.filename}
        className="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
      >
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
        </svg>
        Download
      </a>

      {/* Archive */}
      <button
        onClick={handleArchive}
        disabled={archiving || capture.archived}
        className="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v0a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
        </svg>
        {capture.archived ? 'Archived' : archiving ? 'Archiving…' : 'Archive'}
      </button>

      {/* Delete */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogTrigger asChild>
          <button className="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-red-400 hover:bg-zinc-800 hover:text-red-300 transition-colors">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a1 1 0 011-1h6a1 1 0 011 1v2" />
            </svg>
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
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
