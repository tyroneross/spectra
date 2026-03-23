import { listCaptures, listSessions } from '@/lib/data'
import type { CaptureFilters } from '@/lib/types'
import { FilterPanel } from '@/components/filter-panel'
import { CapturesClient } from '@/components/captures-client'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function getString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function CapturesPage({ searchParams }: PageProps) {
  const sp = await searchParams

  const filters: CaptureFilters = {}
  const sessionId = getString(sp.sessionId)
  if (sessionId) filters.sessionId = sessionId

  const platform = getString(sp.platform)
  if (platform) filters.platform = platform as CaptureFilters['platform']

  const type = getString(sp.type)
  if (type === 'screenshot' || type === 'video') filters.type = type

  const search = getString(sp.search)
  if (search) filters.search = search

  const sort = getString(sp.sort)
  if (sort) filters.sort = sort as CaptureFilters['sort']

  const dateFrom = getString(sp.dateFrom)
  if (dateFrom) filters.dateFrom = Number(dateFrom)

  const dateTo = getString(sp.dateTo)
  if (dateTo) filters.dateTo = Number(dateTo)

  const [captures, sessions] = await Promise.all([
    listCaptures(filters),
    listSessions(),
  ])

  // Build per-session capture counts from the full unfiltered set
  // (just use the sessions' captureCount field which is always fresh)
  const sessionOptions = sessions.map((s) => ({
    id: s.id,
    name: s.name,
    count: s.captureCount,
  }))

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Filter sidebar */}
      <div className="hidden md:block w-60 shrink-0 border-r border-zinc-800 p-6 overflow-y-auto">
        <FilterPanel sessions={sessionOptions} />
      </div>

      {/* Main content */}
      <main className="flex-1 min-w-0 p-6 overflow-y-auto">
        {/* Mobile filter button lives inside FilterPanel */}
        <div className="md:hidden mb-4">
          <FilterPanel sessions={sessionOptions} />
        </div>
        <CapturesClient captures={captures} />
      </main>
    </div>
  )
}
