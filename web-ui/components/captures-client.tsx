'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Capture } from '@/lib/types'
import { ActionBar } from './action-bar'
import { MediaGrid } from './media-grid'

interface CapturesClientProps {
  captures: Capture[]
}

export function CapturesClient({ captures }: CapturesClientProps) {
  const router = useRouter()
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)

  const handleToggleBulk = () => {
    setBulkMode((prev) => !prev)
    setSelectedIds(new Set())
  }

  const handleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleExport = () => {
    if (selectedIds.size === 0) return
    router.push(`/export?selected=${encodeURIComponent([...selectedIds].join(','))}`)
  }

  const handleArchive = async () => {
    if (selectedIds.size === 0 || archiving) return
    setArchiving(true)
    setActionError(null)
    try {
      const selectedCaptures = captures.filter((capture) => selectedIds.has(capture.id))
      for (const capture of selectedCaptures) {
        const res = await fetch('/api/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'archive', path: capture.path }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(data.error ?? `Archive failed for ${capture.filename}`)
        }
      }
      setSelectedIds(new Set())
      setBulkMode(false)
      router.refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Archive failed. Check file permissions and retry.')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="flex-1 min-w-0">
      <ActionBar
        bulkMode={bulkMode}
        onToggleBulk={handleToggleBulk}
        selectedCount={selectedIds.size}
        onExport={handleExport}
        onArchive={handleArchive}
      />
      {actionError && (
        <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          {actionError}
        </div>
      )}
      {archiving && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
          Moving selected captures to the archive...
        </div>
      )}
      <MediaGrid
        captures={captures}
        bulkMode={bulkMode}
        selectedIds={selectedIds}
        onSelect={handleSelect}
      />
    </div>
  )
}
