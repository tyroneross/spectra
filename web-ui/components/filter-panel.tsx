'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface SessionOption {
  id: string
  name: string
  count: number
}

interface FilterPanelProps {
  sessions: SessionOption[]
  className?: string
}

const PLATFORMS = ['web', 'macos', 'ios', 'watchos'] as const
const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  macos: 'macOS',
  ios: 'iOS',
  watchos: 'watchOS',
}

const DATE_PRESETS = [
  { label: 'All', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
]

function FilterContent({ sessions }: FilterPanelProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

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

  const currentSession = searchParams.get('sessionId') ?? ''
  const currentPlatform = searchParams.get('platform') ?? ''
  const currentType = searchParams.get('type') ?? ''
  const currentDate = searchParams.get('date') ?? ''

  const getDateRange = (preset: string): { dateFrom?: number; dateTo?: number } => {
    const now = Date.now()
    const day = 86400000
    if (preset === 'today') return { dateFrom: now - day }
    if (preset === 'week') return { dateFrom: now - 7 * day }
    if (preset === 'month') return { dateFrom: now - 30 * day }
    return {}
  }

  const setDatePreset = (preset: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('dateFrom')
    params.delete('dateTo')
    params.delete('date')
    if (preset) {
      params.set('date', preset)
      const range = getDateRange(preset)
      if (range.dateFrom) params.set('dateFrom', String(range.dateFrom))
    }
    router.push(`/captures?${params.toString()}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
          Sessions
        </p>
        <div className="overflow-hidden rounded-md border border-zinc-800">
          <button
            type="button"
            onClick={() => setParam('sessionId', null)}
            aria-pressed={!currentSession}
            className={cn(
              'flex min-h-11 w-full items-center justify-between px-3 text-sm transition-colors sm:min-h-8',
              !currentSession
                ? 'text-zinc-50 font-medium'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            )}
          >
            <span>All Sessions</span>
          </button>
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setParam('sessionId', s.id)}
              aria-pressed={currentSession === s.id}
              className={cn(
                'flex min-h-11 w-full items-center justify-between border-t border-zinc-800 px-3 text-sm transition-colors sm:min-h-8',
                currentSession === s.id
                  ? 'text-zinc-50 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              )}
            >
              <span className="truncate text-left">{s.name}</span>
              <span className="text-xs text-zinc-600 ml-2 shrink-0">{s.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
          Platform
        </p>
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-zinc-800">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setParam('platform', currentPlatform === p ? null : p)}
              aria-pressed={currentPlatform === p}
              className={cn(
                'min-h-11 px-2 text-xs transition-colors odd:border-r odd:border-zinc-800 [&:nth-child(n+3)]:border-t [&:nth-child(n+3)]:border-zinc-800 sm:min-h-8',
                currentPlatform === p
                  ? 'text-zinc-50 font-medium'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-300'
              )}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
          Type
        </p>
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-zinc-800">
          {(['screenshot', 'video'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setParam('type', currentType === t ? null : t)}
              aria-pressed={currentType === t}
              className={cn(
                'min-h-11 px-2 text-xs capitalize transition-colors first:border-r first:border-zinc-800 sm:min-h-8',
                currentType === t
                  ? 'text-zinc-50 font-medium'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-300'
              )}
            >
              {t === 'screenshot' ? 'Screenshots' : 'Video'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
          Date
        </p>
        <div className="overflow-hidden rounded-md border border-zinc-800">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setDatePreset(preset.value)}
              aria-pressed={currentDate === preset.value}
              className={cn(
                'min-h-11 w-full border-t border-zinc-800 px-3 text-left text-sm first:border-t-0 transition-colors sm:min-h-8',
                currentDate === preset.value
                  ? 'text-zinc-50 font-medium'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function FilterPanel({ sessions, className }: FilterPanelProps) {
  return (
    <>
      <aside className={cn('hidden md:block w-60 shrink-0 pr-6', className)}>
        <FilterContent sessions={sessions} />
      </aside>

      <div className="md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="min-h-11 border-zinc-700 text-zinc-300">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Filters
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="bg-zinc-950 border-zinc-800 w-72 p-6">
            <p className="text-sm font-medium text-zinc-200 mb-6">Filters</p>
            <FilterContent sessions={sessions} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
