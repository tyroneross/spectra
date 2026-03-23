'use client'

import { useState, useRef, useCallback } from 'react'
import type { Capture } from '@/lib/types'
import { relativeTime, formatBytes } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ArchiveClientProps {
  initialCaptures: Capture[]
}

export function ArchiveClient({ initialCaptures }: ArchiveClientProps) {
  const [captures, setCaptures] = useState(initialCaptures)
  const [deleteTarget, setDeleteTarget] = useState<Capture | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function reload() {
    const res = await fetch('/api/archive')
    if (res.ok) {
      const data = await res.json() as Capture[]
      setCaptures(data)
    }
  }

  async function handleRestore(capture: Capture) {
    setActionLoading(capture.id)
    try {
      await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', path: capture.path }),
      })
      await reload()
    } catch (err) {
      console.error('[restore]', err)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setActionLoading(deleteTarget.id)
    try {
      await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', path: deleteTarget.path }),
      })
      setDeleteTarget(null)
      await reload()
    } catch (err) {
      console.error('[delete]', err)
    } finally {
      setActionLoading(null)
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        await fetch('/api/archive', { method: 'POST', body: form })
      }
      await reload()
    } catch (err) {
      console.error('[upload]', err)
    } finally {
      setUploading(false)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(true)
  }

  function handleDragLeave() {
    setDragActive(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files)
    }
  }

  return (
    <div className="space-y-6">
      {/* Archive grid */}
      {captures.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm font-medium text-zinc-300 mb-1">Nothing archived yet</p>
          <p className="text-sm text-zinc-500">Archive captures to store them separately from your active collection.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {captures.map((capture) => (
            <div
              key={capture.id}
              className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden"
            >
              <div style={{ aspectRatio: '16/10' }}>
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
              </div>
              <div className="px-3 py-2">
                <p className="text-xs font-mono text-zinc-300 truncate mb-0.5" title={capture.filename}>
                  {capture.filename}
                </p>
                <p className="text-xs text-zinc-500">{relativeTime(capture.timestamp)}</p>
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={() => handleRestore(capture)}
                    disabled={actionLoading === capture.id}
                    className="flex-1 text-xs py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors disabled:opacity-50"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => setDeleteTarget(capture)}
                    disabled={actionLoading === capture.id}
                    className="text-xs px-2 py-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                    title="Delete permanently"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          dragActive
            ? 'border-zinc-400 bg-zinc-800'
            : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-900'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        />
        {uploading ? (
          <p className="text-sm text-zinc-400">Uploading...</p>
        ) : (
          <>
            <svg className="w-8 h-8 text-zinc-600 mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm text-zinc-400">
              {dragActive ? 'Drop to upload' : 'Drop files here or click to upload'}
            </p>
            <p className="text-xs text-zinc-600 mt-1">Images and videos</p>
          </>
        )}
      </div>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-zinc-50">Permanently delete?</DialogTitle>
            <DialogDescription className="text-zinc-400">
              <span className="font-mono text-xs text-zinc-300">{deleteTarget?.filename}</span> will be
              permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteConfirm}
              disabled={!!actionLoading}
              className="bg-red-600 hover:bg-red-700 text-white border-0"
            >
              {actionLoading ? 'Deleting...' : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
