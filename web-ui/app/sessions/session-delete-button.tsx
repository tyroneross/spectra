'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface SessionDeleteButtonProps {
  sessionId: string
}

export function SessionDeleteButton({ sessionId }: SessionDeleteButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  function handleDelete() {
    setLoading(true)
    fetch('/api/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId }),
    })
      .then(() => {
        setOpen(false)
        router.refresh()
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] px-3 py-1.5 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-white/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
        title="Delete session"
      >
        Delete
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border border-white/[0.08] bg-zinc-950/95 text-zinc-100 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="text-zinc-50">Delete session?</DialogTitle>
            <DialogDescription className="text-zinc-400">
              This will permanently delete the session and all its data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="border-white/[0.08] text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={loading}
              className="border border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20 hover:text-rose-200 disabled:opacity-50"
            >
              {loading ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
