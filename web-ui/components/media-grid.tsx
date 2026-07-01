'use client'

import type { Capture } from '@/lib/types'
import { MediaCard } from './media-card'
import { EmptyState } from './empty-state'

interface MediaGridProps {
  captures: Capture[]
  loading?: boolean
  bulkMode?: boolean
  selectedIds?: Set<string>
  onSelect?: (id: string, checked: boolean) => void
}

function SkeletonCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.025]">
      <div style={{ aspectRatio: '16/10' }} className="bg-white/[0.04]" />
      <div className="space-y-1.5 px-3 py-2.5">
        <div className="h-3 w-3/4 rounded bg-white/[0.06]" />
        <div className="h-2.5 w-1/3 rounded bg-white/[0.04]" />
      </div>
    </div>
  )
}

const GRID_CLASS = 'grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4'

export function MediaGrid({
  captures,
  loading,
  bulkMode,
  selectedIds,
  onSelect,
}: MediaGridProps) {
  if (loading) {
    return (
      <div className={GRID_CLASS}>
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  if (captures.length === 0) {
    return (
      <EmptyState
        icon={
          <svg
            className="w-12 h-12"
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            viewBox="0 0 24 24"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        }
        title="No captures yet"
        description="Screenshots and videos captured during sessions will appear here."
      />
    )
  }

  return (
    <div className={GRID_CLASS}>
      {captures.map((capture) => (
        <MediaCard
          key={capture.id}
          capture={capture}
          bulkMode={bulkMode}
          selected={selectedIds?.has(capture.id)}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
