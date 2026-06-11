'use client'

import Link from 'next/link'
import { Check } from 'lucide-react'
import type { Capture } from '@/lib/types'
import { relativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface MediaCardProps {
  capture: Capture
  bulkMode?: boolean
  selected?: boolean
  onSelect?: (id: string, checked: boolean) => void
}

const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  macos: 'macOS',
  ios: 'iOS',
  watchos: 'watchOS',
}

export function MediaCard({ capture, bulkMode, selected, onSelect }: MediaCardProps) {
  const handleCheckbox = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    onSelect?.(capture.id, e.target.checked)
  }

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect?.(capture.id, !selected)
  }

  return (
    <Link href={`/captures/${capture.id}`} className="group block bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400">
      <div
        className={cn(
          'overflow-hidden transition-all',
          selected
            ? 'ring-2 ring-inset ring-zinc-300'
            : 'hover:bg-zinc-800/60'
        )}
      >
        {/* Thumbnail — 16:10 aspect ratio */}
        <div className="relative" style={{ aspectRatio: '16/10' }}>
          {capture.type === 'video' ? (
            <video
              src={`/api/media/${capture.path}`}
              className="w-full h-full object-cover bg-zinc-950"
              preload="metadata"
              muted
            />
          ) : (
            <img
              src={`/api/media/${capture.path}`}
              alt={capture.filename}
              className="w-full h-full object-cover bg-zinc-950"
              loading="lazy"
            />
          )}

          {/* Video indicator */}
          {capture.type === 'video' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center">
                <svg className="w-3 h-3 text-white ml-0.5" fill="currentColor" viewBox="0 0 8 10">
                  <path d="M0 0l8 5-8 5V0z" />
                </svg>
              </div>
            </div>
          )}

          {/* Bulk checkbox */}
          {(bulkMode || selected) && (
            <div
              className="absolute top-2 left-2 z-10"
              onClick={handleCheckboxClick}
            >
              <input
                type="checkbox"
                checked={selected ?? false}
                onChange={handleCheckbox}
                aria-label={`Select ${capture.filename}`}
                className="min-h-6 min-w-6 rounded accent-white cursor-pointer"
              />
            </div>
          )}

          {/* Hover checkbox in non-bulk mode */}
          {!bulkMode && (
            <div
              className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={handleCheckboxClick}
            >
              <input
                type="checkbox"
                checked={false}
                onChange={handleCheckbox}
                aria-label={`Select ${capture.filename}`}
                className="min-h-6 min-w-6 rounded accent-white cursor-pointer"
              />
            </div>
          )}
          {selected && (
            <div className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-zinc-50 text-zinc-950">
              <Check className="size-4" aria-hidden="true" />
            </div>
          )}

          {/* Session badge — bottom left */}
          {capture.sessionName && (
            <div className="absolute bottom-2 left-2">
              <span className="block max-w-[120px] truncate bg-black/70 px-1.5 py-0.5 text-xs text-zinc-200">
                {capture.sessionName}
              </span>
            </div>
          )}

          {/* Platform badge — bottom right */}
          {capture.platform && (
            <div className="absolute bottom-2 right-2">
              <span className="bg-black/70 px-1.5 py-0.5 text-xs text-zinc-300">
                {PLATFORM_LABELS[capture.platform] ?? capture.platform}
              </span>
            </div>
          )}
        </div>

        {/* Card footer */}
        <div className="min-h-[4.75rem] px-3 py-2">
          <p className="text-xs font-mono text-zinc-300 truncate" title={capture.filename}>
            {capture.filename}
          </p>
          {capture.guide && (
            <p className="mt-1 truncate text-xs text-zinc-400" title={capture.guide}>
              {capture.guide}
            </p>
          )}
          <p className="text-xs text-zinc-500 mt-0.5">{relativeTime(capture.timestamp)}</p>
        </div>
      </div>
    </Link>
  )
}
