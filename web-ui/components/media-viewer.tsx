'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Capture } from '@/lib/types'
import { cn } from '@/lib/utils'

interface MediaViewerProps {
  capture: Capture
}

export function MediaViewer({ capture }: MediaViewerProps) {
  const router = useRouter()
  const [zoomed, setZoomed] = useState(false)

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomed) {
          setZoomed(false)
        } else {
          router.back()
        }
      }
    },
    [router, zoomed]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [handleEscape])

  const isVideo = capture.type === 'video'
  const src = `/api/media/${capture.path}`

  return (
    <div className="relative flex items-center justify-center w-full h-full rounded-xl border border-white/[0.06] bg-black/50 overflow-hidden">
      {isVideo ? (
        <video
          src={src}
          controls
          className="max-w-full max-h-full object-contain"
        />
      ) : (
        <div
          className={cn(
            'flex items-center justify-center w-full h-full transition-transform duration-200',
            zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'
          )}
          onClick={() => setZoomed((v) => !v)}
        >
          <img
            src={src}
            alt={capture.filename}
            className={cn(
              'object-contain transition-transform duration-200',
              zoomed
                ? 'max-w-none max-h-none scale-150 origin-center'
                : 'max-w-full max-h-full'
            )}
          />
        </div>
      )}

      {/* Zoom hint for images */}
      {!isVideo && (
        <div className="absolute bottom-3 right-3 text-xs text-zinc-500 pointer-events-none select-none">
          {zoomed ? 'Click to zoom out · Esc' : 'Click to zoom · Esc to go back'}
        </div>
      )}
    </div>
  )
}
