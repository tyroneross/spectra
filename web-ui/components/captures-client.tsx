'use client'

import { useState } from 'react'
import type { Capture } from '@/lib/types'
import { ActionBar } from './action-bar'
import { MediaGrid } from './media-grid'

interface CapturesClientProps {
  captures: Capture[]
}

export function CapturesClient({ captures }: CapturesClientProps) {
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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
    // TODO: Iteration 2 — wire to export API with selectedIds
    console.log('[captures] export selected:', [...selectedIds])
  }

  const handleArchive = () => {
    // TODO: Iteration 2 — wire to archive API with selectedIds
    console.log('[captures] archive selected:', [...selectedIds])
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
      <MediaGrid
        captures={captures}
        bulkMode={bulkMode}
        selectedIds={selectedIds}
        onSelect={handleSelect}
      />
    </div>
  )
}
