'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState, useRef } from 'react'
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

  return (
    <div className="flex items-center gap-3 mb-4">
      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8" />
          <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
        </svg>
        <Input
          value={searchValue}
          onChange={handleSearch}
          placeholder="Search captures…"
          className="pl-8 bg-zinc-900 border-zinc-700 text-zinc-200 placeholder:text-zinc-500 h-8 text-sm focus-visible:ring-zinc-600"
        />
      </div>

      {/* Sort */}
      <Select value={currentSort} onValueChange={(v) => setParam('sort', v)}>
        <SelectTrigger className="w-36 h-8 bg-zinc-900 border-zinc-700 text-zinc-300 text-sm focus:ring-zinc-600">
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

      {/* Bulk actions */}
      {bulkMode && selectedCount > 0 && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={onExport}
            className="h-8 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 text-xs"
          >
            Export {selectedCount}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onArchive}
            className="h-8 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 text-xs"
          >
            Archive {selectedCount}
          </Button>
        </>
      )}

      {/* Bulk toggle */}
      <Button
        size="sm"
        variant={bulkMode ? 'default' : 'outline'}
        onClick={onToggleBulk}
        className={
          bulkMode
            ? 'h-8 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-xs'
            : 'h-8 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 text-xs'
        }
      >
        {bulkMode ? 'Cancel' : 'Select'}
      </Button>
    </div>
  )
}
