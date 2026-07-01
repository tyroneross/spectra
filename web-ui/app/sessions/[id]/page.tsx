import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getSession, listCaptures } from '@/lib/data'
import { relativeTime } from '@/lib/utils'
import { SessionTimeline } from '@/components/session-timeline'
import { MediaGrid } from '@/components/media-grid'

interface PageProps {
  params: Promise<{ id: string }>
}

const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  macos: 'macOS',
  ios: 'iOS',
  watchos: 'watchOS',
}

export default async function SessionDetailPage({ params }: PageProps) {
  const { id } = await params
  const [session, captures] = await Promise.all([
    getSession(id),
    listCaptures({ sessionId: id }),
  ])

  if (!session) {
    notFound()
  }

  const isActive = session.status === 'active'
  const run = session.run
  const projectLabel = session.projectName ?? 'Current project'
  const sessionTypeLabel = session.sessionType ?? session.name

  const targetLabel = typeof session.target === 'string'
    ? session.target
    : (session.target as { url?: string; app?: string; device?: string })?.url
      ?? (session.target as { url?: string; app?: string; device?: string })?.app
      ?? (session.target as { url?: string; app?: string; device?: string })?.device
      ?? String(session.target)

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/sessions" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          Sessions
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-zinc-300 truncate max-w-xs">Run {session.id}</span>
      </div>

      {/* Header */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-zinc-50">Run {session.id}</h1>
            <p className="mt-1 truncate text-[11px] text-zinc-500">
              {projectLabel} · {sessionTypeLabel}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] text-zinc-500">
              {PLATFORM_LABELS[session.platform] ?? session.platform}
            </span>
            <span
              className={[
                'text-[11px] font-medium',
                isActive ? 'text-green-400' : 'text-zinc-500',
              ].join(' ')}
            >
              {isActive ? 'Active' : 'Closed'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-[11px] text-zinc-500 mb-0.5">Project</p>
            <p className="text-[13px] text-zinc-100 truncate">{projectLabel}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 mb-0.5">Session Type</p>
            <p className="text-[13px] text-zinc-100 truncate">{sessionTypeLabel}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 mb-0.5">Target</p>
            <p className="text-[13px] text-zinc-100 truncate">{targetLabel}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 mb-0.5">Steps</p>
            <p className="text-[13px] text-zinc-100">{session.steps.length}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 mb-0.5">Captures</p>
            <p className="text-[13px] text-zinc-100">{session.captureCount}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 mb-0.5">Created</p>
            <p className="text-[13px] text-zinc-100">{relativeTime(session.createdAt)}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 mb-0.5">Decisions</p>
            <p className="text-[13px] text-zinc-100">{run?.decisions.length ?? 0}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 mb-0.5">Recording</p>
            <p className="text-[13px] text-zinc-100 capitalize">{run?.recording.state ?? 'idle'}</p>
          </div>
        </div>
      </div>

      {run && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Run</h2>
            <span className="text-[11px] text-zinc-500">schema v{run.schemaVersion}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[11px] text-zinc-500 mb-0.5">Planner</p>
              <p className="text-[13px] text-zinc-100">{run.planner.source}</p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 mb-0.5">Actions</p>
              <p className="text-[13px] text-zinc-100">{run.actions.length}</p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 mb-0.5">Artifacts</p>
              <p className="text-[13px] text-zinc-100">{run.artifacts.length}</p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 mb-0.5">Source</p>
              <p
                className={[
                  'text-[13px] truncate',
                  run.recording.sourceVerified === false ? 'text-amber-300' : 'text-zinc-100',
                ].join(' ')}
              >
                {run.recording.source ?? 'none'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div>
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-4">Steps</h2>
        <SessionTimeline steps={session.steps} />
      </div>

      {/* Captures */}
      {captures.length > 0 && (
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-4">
            Captures ({captures.length})
          </h2>
          <MediaGrid captures={captures} />
        </div>
      )}
    </main>
  )
}
