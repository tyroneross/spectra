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
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden animate-pulse">
      <div style={{ aspectRatio: '16/10' }} className="bg-zinc-800" />
      <div className="px-3 py-2 space-y-1.5">
        <div className="h-3 bg-zinc-800 rounded w-3/4" />
        <div className="h-2.5 bg-zinc-800 rounded w-1/3" />
      </div>
    </div>
  )
}

export function MediaGrid({
  captures,
  loading,
  bulkMode,
  selectedIds,
  onSelect,
}: MediaGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
