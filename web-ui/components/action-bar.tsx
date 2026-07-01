'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState, useRef } from 'react'
import { Archive, Download, FolderDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ActionBarProps {
  sessionTypes: { name: string; count: number }[]
  bulkMode: boolean
  onToggleBulk: () => void
  selectedCount: number
  onExport: () => void
  onArchive: () => void
  onOpenImport: () => void
  importPanelOpen: boolean
}

const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Newest' },
  { value: 'date-asc', label: 'Oldest' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
]

export function ActionBar({
  sessionTypes,
  bulkMode,
  onToggleBulk,
  selectedCount,
  onExport,
  onArchive,
  onOpenImport,
  importPanelOpen,
}: ActionBarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [searchValue, setSearchValue] = useState(searchParams.get('search') ?? '')

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === null || value === '') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
      router.push(`/captures?${params.toString()}`)
    },
    [router, searchParams]
  )

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchValue(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setParam('search', value || null)
    }, 300)
  }

  const currentSort = searchParams.get('sort') ?? 'date-desc'
  const currentSessionType = searchParams.get('sessionType') ?? '__all'
  const hasSelection = selectedCount > 0

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
        <Input
          value={searchValue}
          onChange={handleSearch}
          placeholder="Search captures…"
          aria-label="Search captures"
          className="min-h-11 border-white/[0.08] bg-white/[0.03] pl-9 text-base text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-2 focus-visible:ring-indigo-400/60 sm:min-h-9 sm:text-sm"
        />
      </div>

      <Select value={currentSort} onValueChange={(v) => setParam('sort', v)}>
        <SelectTrigger aria-label="Sort captures" className="min-h-11 w-full border-white/[0.08] bg-white/[0.03] text-sm text-zinc-300 focus-visible:ring-2 focus-visible:ring-indigo-400/60 sm:min-h-9 sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-white/[0.08] bg-zinc-950/95 text-zinc-300">
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="focus:bg-white/[0.06] focus:text-zinc-100">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentSessionType}
        onValueChange={(v) => setParam('sessionType', v === '__all' ? null : v)}
      >
        <SelectTrigger aria-label="Filter by session type" className="min-h-11 w-full border-white/[0.08] bg-white/[0.03] text-sm text-zinc-300 focus-visible:ring-2 focus-visible:ring-indigo-400/60 sm:min-h-9 sm:w-48">
          <SelectValue placeholder="Session Type" />
        </SelectTrigger>
        <SelectContent className="border-white/[0.08] bg-zinc-950/95 text-zinc-300">
          <SelectItem value="__all" className="focus:bg-white/[0.06] focus:text-zinc-100">
            All Session Types
          </SelectItem>
          {sessionTypes.map((sessionType) => (
            <SelectItem key={sessionType.name} value={sessionType.name} className="focus:bg-white/[0.06] focus:text-zinc-100">
              {sessionType.name} ({sessionType.count})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {bulkMode && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onExport}
            disabled={!hasSelection}
            className={cn(
              'min-h-11 sm:min-h-9',
              hasSelection
                ? 'border-transparent bg-indigo-500 text-white hover:bg-indigo-400'
                : 'border-white/[0.12] bg-white/[0.03] text-zinc-500 hover:bg-white/[0.06]'
            )}
          >
            <Download className="size-4" aria-hidden="true" />
            Export {hasSelection ? selectedCount : ''}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onArchive}
            disabled={!hasSelection}
            className={cn(
              'min-h-11 sm:min-h-9',
              hasSelection
                ? 'border-rose-500/30 bg-rose-500/80 text-white hover:bg-rose-500'
                : 'border-white/[0.12] bg-white/[0.03] text-zinc-500 hover:bg-white/[0.06]'
            )}
          >
            <Archive className="size-4" aria-hidden="true" />
            Archive {hasSelection ? selectedCount : ''}
          </Button>
        </div>
      )}

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onOpenImport}
        className={cn(
          'min-h-11 sm:min-h-9',
          importPanelOpen
            ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
            : 'border-white/[0.12] bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
        )}
      >
        <FolderDown className="size-4" aria-hidden="true" />
        Import
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onToggleBulk}
        className={cn(
          'min-h-11 sm:min-h-9',
          bulkMode
            ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
            : 'border-white/[0.12] bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
        )}
      >
        {bulkMode ? 'Cancel' : 'Select'}
      </Button>
    </div>
  )
}
