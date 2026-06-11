import { listCaptures } from '@/lib/data'
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

  const project = getString(sp.project)
  if (project) filters.project = project

  const sessionType = getString(sp.sessionType)
  if (sessionType) filters.sessionType = sessionType

  const search = getString(sp.search)
  if (search) filters.search = search

  const sort = getString(sp.sort)
  if (sort) filters.sort = sort as CaptureFilters['sort']

  const dateFrom = getString(sp.dateFrom)
  if (dateFrom) filters.dateFrom = Number(dateFrom)

  const dateTo = getString(sp.dateTo)
  if (dateTo) filters.dateTo = Number(dateTo)

  const [captures, allCaptures] = await Promise.all([
    listCaptures(filters),
    listCaptures(),
  ])

  const projectCounts = new Map<string, number>()
  const sessionTypeCounts = new Map<string, number>()

  for (const capture of allCaptures) {
    const projectName = capture.projectName ?? capture.productName ?? capture.repoName ?? 'Current project'
    projectCounts.set(projectName, (projectCounts.get(projectName) ?? 0) + 1)
    if (capture.sessionType) {
      sessionTypeCounts.set(capture.sessionType, (sessionTypeCounts.get(capture.sessionType) ?? 0) + 1)
    }
  }

  const projectOptions = [...projectCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const sessionTypeOptions = [...sessionTypeCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-5 sm:px-6">
        <FilterPanel
          projects={projectOptions}
          display="desktop"
          className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto"
        />

        <main className="min-w-0 flex-1">
          <div className="mb-5 flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-zinc-50">
              Captures
              <span className="ml-2 text-sm font-normal text-zinc-500">{captures.length}</span>
            </h1>
            <p className="text-sm text-zinc-400">
              Review screenshots and recordings from active Spectra sessions.
            </p>
          </div>

          <div className="mb-4 md:hidden">
            <FilterPanel projects={projectOptions} display="mobile" />
          </div>
          <CapturesClient captures={captures} sessionTypes={sessionTypeOptions} />
        </main>
      </div>
    </div>
  )
}
