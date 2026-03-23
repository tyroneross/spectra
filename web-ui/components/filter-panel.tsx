'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
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
      {/* Sessions */}
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
          Sessions
        </p>
        <div className="space-y-0.5">
          <button
            onClick={() => setParam('sessionId', null)}
            className={cn(
              'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors',
              !currentSession
                ? 'text-zinc-50 bg-zinc-800'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            )}
          >
            <span>All Sessions</span>
          </button>
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setParam('sessionId', s.id)}
              className={cn(
                'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors',
                currentSession === s.id
                  ? 'text-zinc-50 bg-zinc-800'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              )}
            >
              <span className="truncate text-left">{s.name}</span>
              <span className="text-xs text-zinc-600 ml-2 shrink-0">{s.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Platform */}
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
          Platform
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setParam('platform', currentPlatform === p ? null : p)}
              className={cn(
                'px-2.5 py-1 rounded text-xs transition-colors border',
                currentPlatform === p
                  ? 'bg-zinc-700 border-zinc-600 text-zinc-100'
                  : 'bg-transparent border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
              )}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Type */}
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
          Type
        </p>
        <div className="flex gap-1.5">
          {(['screenshot', 'video'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setParam('type', currentType === t ? null : t)}
              className={cn(
                'px-2.5 py-1 rounded text-xs transition-colors border capitalize',
                currentType === t
                  ? 'bg-zinc-700 border-zinc-600 text-zinc-100'
                  : 'bg-transparent border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
              )}
            >
              {t === 'screenshot' ? 'Screenshots' : 'Video'}
            </button>
          ))}
        </div>
      </div>

      {/* Date */}
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
          Date
        </p>
        <div className="space-y-0.5">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => setDatePreset(preset.value)}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded text-sm transition-colors',
                currentDate === preset.value
                  ? 'text-zinc-50 bg-zinc-800'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
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
      {/* Desktop sidebar */}
      <aside className={cn('hidden md:block w-60 shrink-0 pr-6', className)}>
        <FilterContent sessions={sessions} />
      </aside>

      {/* Mobile sheet trigger */}
      <div className="md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="border-zinc-700 text-zinc-300">
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M3 6h18M6 12h12M9 18h6" />
              </svg>
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
