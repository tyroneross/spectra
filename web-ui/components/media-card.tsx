'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Check, ImageOff, Play } from 'lucide-react'
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
  const isVideo = capture.type === 'video'
  const [mediaFailed, setMediaFailed] = useState(false)

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect?.(capture.id, !selected)
  }

  return (
    <Link
      href={`/captures/${capture.id}`}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
    >
      <div
        className={cn(
          'overflow-hidden rounded-xl border transition-all duration-200 ease-out',
          selected
            ? 'border-indigo-400/70 bg-indigo-400/[0.04] ring-1 ring-indigo-400/40'
            : 'border-white/[0.06] bg-white/[0.025] hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.045] hover:shadow-xl hover:shadow-black/50',
        )}
      >
        {/* Thumbnail — matte frame gives dark screenshots contrast against the card */}
        <div className="relative aspect-[16/10] overflow-hidden border-b border-white/[0.06] bg-black/50">
          {mediaFailed ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-zinc-600">
              <ImageOff className="size-6" aria-hidden="true" />
              <span className="text-[11px] text-zinc-500">Preview unavailable</span>
            </div>
          ) : isVideo ? (
            <video
              src={`/api/media/${capture.path}`}
              className="h-full w-full object-cover"
              preload="metadata"
              muted
              onError={() => setMediaFailed(true)}
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/api/media/${capture.path}`}
              alt={capture.filename}
              className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
              loading="lazy"
              onError={() => setMediaFailed(true)}
            />
          )}

          {/* subtle scrim so overlay chips stay legible over any screenshot */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/40 opacity-70" />

          {/* Video play affordance */}
          {isVideo && !mediaFailed && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/40 backdrop-blur-md transition-all duration-200 group-hover:scale-105 group-hover:border-indigo-300/50 group-hover:bg-indigo-500/30">
                <Play className="ml-0.5 size-4 text-white" fill="currentColor" aria-hidden="true" />
              </div>
            </div>
          )}

          {/* Selection control — reveals on hover, persistent in bulk/selected */}
          <button
            type="button"
            onClick={toggle}
            aria-label={selected ? `Deselect ${capture.filename}` : `Select ${capture.filename}`}
            aria-pressed={selected ?? false}
            className={cn(
              'absolute left-2 top-2 z-10 flex size-6 items-center justify-center rounded-md border backdrop-blur-md transition-all',
              selected
                ? 'border-indigo-300/60 bg-indigo-500/80 text-white'
                : 'border-white/20 bg-black/40 text-transparent hover:border-white/40 hover:text-white/70',
              bulkMode || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <Check className="size-3.5" aria-hidden="true" />
          </button>

          {/* Overlay chips — glass, legible over media */}
          <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
            {capture.sessionName ? (
              <span className="max-w-[60%] truncate rounded-md border border-white/10 bg-black/45 px-1.5 py-0.5 text-[11px] text-zinc-200 backdrop-blur-md">
                {capture.sessionName}
              </span>
            ) : (
              <span />
            )}
            {capture.platform && (
              <span className="shrink-0 rounded-md border border-white/10 bg-black/45 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300 backdrop-blur-md">
                {PLATFORM_LABELS[capture.platform] ?? capture.platform}
              </span>
            )}
          </div>
        </div>

        {/* Footer — three-line hierarchy: name → (guide) → time */}
        <div className="px-3 py-2.5">
          <p className="truncate text-[13px] font-medium text-zinc-100" title={capture.filename}>
            {capture.filename}
          </p>
          {capture.guide && (
            <p className="mt-0.5 truncate text-[11px] text-zinc-400" title={capture.guide}>
              {capture.guide}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-zinc-500">{relativeTime(capture.timestamp)}</p>
        </div>
      </div>
    </Link>
  )
}
