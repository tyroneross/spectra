'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface ProjectOption {
  name: string
  count: number
}

interface FilterPanelProps {
  projects: ProjectOption[]
  className?: string
  display?: 'desktop' | 'mobile' | 'both'
}

interface FilterContentProps {
  projects: ProjectOption[]
  density?: 'rail' | 'compact'
  onFilterChange?: () => void
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

function FilterContent({ projects, density = 'rail', onFilterChange }: FilterContentProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isCompact = density === 'compact'

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === null || value === '') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
      if (key === 'project') params.delete('sessionId')
      router.push(`/captures?${params.toString()}`)
      onFilterChange?.()
    },
    [onFilterChange, router, searchParams]
  )

  const currentProject = searchParams.get('project') ?? ''
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
    onFilterChange?.()
  }

  return (
    <div className={cn(isCompact ? 'space-y-4' : 'space-y-6')}>
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
          Projects
        </p>
        <div className="overflow-hidden rounded-md border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setParam('project', null)}
            aria-pressed={!currentProject}
            className={cn(
              'flex w-full items-center justify-between px-3 text-sm transition-colors',
              isCompact ? 'min-h-9' : 'min-h-11 sm:min-h-8',
              !currentProject
                ? 'bg-indigo-400/10 text-indigo-300 font-medium'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            )}
          >
            <span>All Projects</span>
          </button>
          {projects.map((project) => (
            <button
              key={project.name}
              type="button"
              onClick={() => setParam('project', project.name)}
              aria-pressed={currentProject === project.name}
              className={cn(
                'flex w-full items-center justify-between border-t border-white/[0.08] px-3 text-sm transition-colors',
                isCompact ? 'min-h-9' : 'min-h-11 sm:min-h-8',
                currentProject === project.name
                  ? 'bg-indigo-400/10 text-indigo-300 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
              )}
            >
              <span className="truncate text-left">{project.name}</span>
              <span className="text-xs text-zinc-600 ml-2 shrink-0">{project.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
          Platform
        </p>
        <div
          className={cn(
            'grid overflow-hidden rounded-md border border-white/[0.08]',
            isCompact ? 'grid-cols-4' : 'grid-cols-2'
          )}
        >
          {PLATFORMS.map((p, index) => (
            <button
              key={p}
              type="button"
              onClick={() => setParam('platform', currentPlatform === p ? null : p)}
              aria-pressed={currentPlatform === p}
              className={cn(
                'px-2 text-xs transition-colors',
                isCompact
                  ? cn('min-h-9', index > 0 && 'border-l border-white/[0.08]')
                  : 'min-h-11 odd:border-r odd:border-white/[0.08] [&:nth-child(n+3)]:border-t [&:nth-child(n+3)]:border-white/[0.08] sm:min-h-8',
                currentPlatform === p
                  ? 'bg-indigo-400/10 text-indigo-300 font-medium'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-300'
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
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-white/[0.08]">
          {(['screenshot', 'video'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setParam('type', currentType === t ? null : t)}
              aria-pressed={currentType === t}
              className={cn(
                'px-2 text-xs capitalize transition-colors first:border-r first:border-white/[0.08]',
                isCompact ? 'min-h-9' : 'min-h-11 sm:min-h-8',
                currentType === t
                  ? 'bg-indigo-400/10 text-indigo-300 font-medium'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-300'
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
        <div
          className={cn(
            'overflow-hidden rounded-md border border-white/[0.08]',
            isCompact && 'grid grid-cols-2 sm:grid-cols-4'
          )}
        >
          {DATE_PRESETS.map((preset, index) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setDatePreset(preset.value)}
              aria-pressed={currentDate === preset.value}
              className={cn(
                'min-h-11 w-full px-3 text-sm transition-colors sm:min-h-8',
                isCompact
                  ? cn(
                      'min-h-9 text-center text-xs',
                      index > 0 && 'border-l border-white/[0.08]',
                      index > 1 && 'border-t border-white/[0.08] sm:border-t-0'
                    )
                  : 'border-t border-white/[0.08] text-left first:border-t-0',
                currentDate === preset.value
                  ? 'bg-indigo-400/10 text-indigo-300 font-medium'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
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

export function FilterPanel({ projects, className, display = 'both' }: FilterPanelProps) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const mobilePanelId = 'capture-mobile-filters'

  return (
    <>
      {(display === 'desktop' || display === 'both') && (
        <aside className={cn('hidden md:block w-60 shrink-0 pr-6', className)}>
          <FilterContent projects={projects} />
        </aside>
      )}

      {(display === 'mobile' || display === 'both') && (
        <div className="md:hidden space-y-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-controls={mobilePanelId}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
            className="min-h-11 border-zinc-700 text-zinc-300"
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filters
          </Button>
          {filtersOpen && (
            <div
              id={mobilePanelId}
              className="w-full max-w-md rounded-md border border-white/[0.08] bg-zinc-950/95 p-3 shadow-lg shadow-black/20 sm:p-4"
            >
              <FilterContent
                projects={projects}
                density="compact"
                onFilterChange={() => setFiltersOpen(false)}
              />
            </div>
          )}
        </div>
      )}
    </>
  )
}
