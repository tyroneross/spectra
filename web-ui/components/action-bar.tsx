'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState, useRef } from 'react'
import { Archive, Download, Search } from 'lucide-react'
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
  bulkMode: boolean
  onToggleBulk: () => void
  selectedCount: number
  onExport: () => void
  onArchive: () => void
}

const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Newest' },
  { value: 'date-asc', label: 'Oldest' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
]

export function ActionBar({
  bulkMode,
  onToggleBulk,
  selectedCount,
  onExport,
  onArchive,
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
          className="min-h-11 border-zinc-700 bg-zinc-900 pl-9 text-base text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-zinc-600 sm:min-h-9 sm:text-sm"
        />
      </div>

      <Select value={currentSort} onValueChange={(v) => setParam('sort', v)}>
        <SelectTrigger aria-label="Sort captures" className="min-h-11 w-full border-zinc-700 bg-zinc-900 text-sm text-zinc-300 focus:ring-zinc-600 sm:min-h-9 sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-300">
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="focus:bg-zinc-800 focus:text-zinc-100">
              {opt.label}
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
            className="min-h-11 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 sm:min-h-9"
          >
            <Download className="size-4" aria-hidden="true" />
            Export {hasSelection ? selectedCount : ''}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onArchive}
            disabled={!hasSelection}
            className="min-h-11 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 sm:min-h-9"
          >
            <Archive className="size-4" aria-hidden="true" />
            Archive {hasSelection ? selectedCount : ''}
          </Button>
        </div>
      )}

      <Button
        size="sm"
        variant={bulkMode ? 'default' : 'outline'}
        onClick={onToggleBulk}
        className={
          bulkMode
            ? 'min-h-11 bg-zinc-700 text-zinc-100 hover:bg-zinc-600 sm:min-h-9'
            : 'min-h-11 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 sm:min-h-9'
        }
      >
        {bulkMode ? 'Cancel' : 'Select'}
      </Button>
    </div>
  )
}
