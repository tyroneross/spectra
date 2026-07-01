'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import type { Capture, CaptureImportCandidate, CaptureImportResult } from '@/lib/types'
import { formatBytes, relativeTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ActionBar } from './action-bar'
import { MediaGrid } from './media-grid'

interface CapturesClientProps {
  captures: Capture[]
  sessionTypes: { name: string; count: number }[]
}

interface MediaTypeGroup {
  type: Capture['type']
  label: string
  captures: Capture[]
}

interface DateGroup {
  key: string
  label: string
  timestamp: number
  mediaGroups: MediaTypeGroup[]
}

interface ProjectGroup {
  key: string
  label: string
  repoName: string
  count: number
  dateGroups: DateGroup[]
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localDateLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function groupCaptures(captures: Capture[]): ProjectGroup[] {
  const projectMap = new Map<string, Capture[]>()
  for (const capture of captures) {
    const repo = capture.repoName ?? 'Current repo'
    const project = capture.projectName ?? capture.productName ?? repo
    const key = `${repo}::${project}`
    const list = projectMap.get(key) ?? []
    list.push(capture)
    projectMap.set(key, list)
  }

  return [...projectMap.entries()]
    .map(([key, projectCaptures]) => {
      const first = projectCaptures[0]
      const dateMap = new Map<string, Capture[]>()
      for (const capture of projectCaptures) {
        const dateKey = localDateKey(capture.timestamp)
        const list = dateMap.get(dateKey) ?? []
        list.push(capture)
        dateMap.set(dateKey, list)
      }

      const dateGroups: DateGroup[] = [...dateMap.entries()]
        .map(([dateKey, dateCaptures]) => {
          const mediaGroups: MediaTypeGroup[] = ([
            ['screenshot', 'Images'],
            ['video', 'Videos'],
          ] as const)
            .map(([type, label]) => ({
              type,
              label,
              captures: dateCaptures.filter((capture) => capture.type === type),
            }))
            .filter((group) => group.captures.length > 0)

          return {
            key: dateKey,
            label: localDateLabel(dateCaptures[0].timestamp),
            timestamp: Math.max(...dateCaptures.map((capture) => capture.timestamp)),
            mediaGroups,
          }
        })
        .sort((a, b) => b.timestamp - a.timestamp)

      const repoName = first.repoName ?? 'Current repo'
      const projectName = first.projectName ?? first.productName ?? repoName

      return {
        key,
        label: projectName,
        repoName,
        count: projectCaptures.length,
        dateGroups,
      }
    })
    .sort((a, b) => b.dateGroups[0]?.timestamp - a.dateGroups[0]?.timestamp)
}

export function CapturesClient({ captures, sessionTypes }: CapturesClientProps) {
  const router = useRouter()
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [importPanelOpen, setImportPanelOpen] = useState(false)
  const [importCandidates, setImportCandidates] = useState<CaptureImportCandidate[] | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResults, setImportResults] = useState<CaptureImportResult[]>([])
  const projectGroups = useMemo(() => groupCaptures(captures), [captures])

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

  const loadImportCandidates = async () => {
    setImportLoading(true)
    setImportError(null)
    try {
      const res = await fetch('/api/imports/spectra')
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Import discovery failed')
      }
      const data = await res.json() as CaptureImportCandidate[]
      setImportCandidates(data)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import discovery failed.')
    } finally {
      setImportLoading(false)
    }
  }

  const handleOpenImport = () => {
    setImportPanelOpen((open) => {
      const next = !open
      if (next && importCandidates === null && !importLoading) {
        void loadImportCandidates()
      }
      return next
    })
  }

  const handleImport = async (candidateId: string) => {
    if (importingId) return
    setImportingId(candidateId)
    setImportError(null)
    try {
      const res = await fetch('/api/imports/spectra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [candidateId] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Import failed')
      }
      const data = await res.json() as { results: CaptureImportResult[] }
      setImportResults(data.results)
      await loadImportCandidates()
      router.refresh()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setImportingId(null)
    }
  }

  return (
    <div className="flex-1 min-w-0">
      <ActionBar
        sessionTypes={sessionTypes}
        bulkMode={bulkMode}
        onToggleBulk={handleToggleBulk}
        selectedCount={selectedIds.size}
        onExport={handleExport}
        onArchive={handleArchive}
        onOpenImport={handleOpenImport}
        importPanelOpen={importPanelOpen}
      />
      {importPanelOpen && (
        <div className="mb-4 rounded-md border border-white/[0.08] bg-zinc-950/80 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-zinc-200">External captures</p>
              <p className="text-xs text-zinc-500">Destination: artifacts/&lt;repo&gt;/...</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={loadImportCandidates}
              disabled={importLoading}
              className="min-h-9 border-zinc-700 text-zinc-300"
            >
              <RefreshCw className={importLoading ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
              Refresh
            </Button>
          </div>

          {importError && (
            <div className="mb-3 rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-200">
              {importError}
            </div>
          )}

          {importResults.length > 0 && (
            <div className="mb-3 rounded-md border border-white/[0.08] bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
              {importResults.map((result) => (
                <p key={result.candidateId}>
                  {result.repoName} {result.sourceType}: {result.copied} imported, {result.skipped} skipped
                  {result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}
                </p>
              ))}
            </div>
          )}

          {importLoading && (
            <div className="rounded-md border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
              Scanning sibling repos...
            </div>
          )}

          {!importLoading && importCandidates?.length === 0 && (
            <div className="rounded-md border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
              No external repo captures found.
            </div>
          )}

          {!importLoading && importCandidates && importCandidates.length > 0 && (
            <div className="divide-y divide-white/[0.08] overflow-hidden rounded-md border border-white/[0.08]">
              {importCandidates.map((candidate) => {
                const isImporting = importingId === candidate.id
                return (
                  <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900 px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-200">
                        {candidate.repoName} · {candidate.sourceType === 'sessions' ? 'Spectra sessions' : 'Artifacts'}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {candidate.fileCount} files · {formatBytes(candidate.totalSize)} · {relativeTime(candidate.latestTimestamp)}
                      </p>
                      <p className="mt-1 truncate font-mono text-xs text-zinc-600">{candidate.destinationRoot}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleImport(candidate.id)}
                      disabled={candidate.alreadyImported || Boolean(importingId)}
                      className="min-h-9 border-zinc-700 text-zinc-300"
                    >
                      {candidate.alreadyImported ? 'Imported' : isImporting ? 'Importing...' : 'Import'}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      {actionError && (
        <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          {actionError}
        </div>
      )}
      {archiving && (
        <div className="mb-4 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-sm text-zinc-300">
          Moving selected captures to the archive...
        </div>
      )}
      {captures.length === 0 ? (
        <MediaGrid captures={captures} />
      ) : (
        <div className="space-y-8">
          {projectGroups.map((projectGroup) => (
            <section key={projectGroup.key} className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] pb-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-zinc-50">{projectGroup.label}</h2>
                  {projectGroup.repoName !== projectGroup.label && (
                    <p className="mt-1 truncate text-sm text-zinc-500">
                      {projectGroup.repoName}
                    </p>
                  )}
                </div>
                <span className="text-sm text-zinc-500">{projectGroup.count} captures</span>
              </div>

              {projectGroup.dateGroups.map((dateGroup) => (
                <section key={`${projectGroup.key}:${dateGroup.key}`} className="space-y-4">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">{dateGroup.label}</h3>
                  {dateGroup.mediaGroups.map((mediaGroup) => (
                    <section key={`${projectGroup.key}:${dateGroup.key}:${mediaGroup.type}`} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                          {mediaGroup.label}
                        </h4>
                        <span className="text-xs text-zinc-600">{mediaGroup.captures.length}</span>
                      </div>
                      <MediaGrid
                        captures={mediaGroup.captures}
                        bulkMode={bulkMode}
                        selectedIds={selectedIds}
                        onSelect={handleSelect}
                      />
                    </section>
                  ))}
                </section>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
