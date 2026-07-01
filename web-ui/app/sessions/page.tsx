import Link from 'next/link'
import { listSessions } from '@/lib/data'
import { relativeTime } from '@/lib/utils'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { SessionDeleteButton } from './session-delete-button'

const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  macos: 'macOS',
  ios: 'iOS',
  watchos: 'watchOS',
}

export default async function SessionsPage() {
  const sessions = await listSessions()

  if (sessions.length === 0) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Sessions</h1>
        <EmptyState
          icon={
            <svg className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M8 12h8M8 8h8M8 16h4" strokeLinecap="round" />
            </svg>
          }
          title="No sessions"
          description="Connect to an app with /spectra:connect to start capturing."
        />
      </main>
    )
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-zinc-50 mb-6">
        Sessions
        <span className="ml-2 text-sm font-normal text-zinc-500">{sessions.length}</span>
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sessions.map((session) => {
          const isActive = session.status === 'active'
          const projectLabel = session.projectName ?? 'Current project'
          const sessionTypeLabel = session.sessionType ?? session.name
          return (
            <div
              key={session.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.045] hover:shadow-xl hover:shadow-black/50"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Status dot */}
                  <span
                    className={[
                      'mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full',
                      isActive ? 'bg-green-400' : 'bg-zinc-600',
                    ].join(' ')}
                    title={isActive ? 'Active' : 'Closed'}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-zinc-100">Run {session.id}</p>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {projectLabel} · {sessionTypeLabel}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] text-zinc-500 shrink-0">
                  {PLATFORM_LABELS[session.platform] ?? session.platform}
                </span>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-zinc-500 mb-3">
                <span>{session.captureCount} capture{session.captureCount !== 1 ? 's' : ''}</span>
                <span>·</span>
                <span>{session.steps.length} step{session.steps.length !== 1 ? 's' : ''}</span>
              </div>

              <div className="text-[11px] text-zinc-600 mb-4">
                {relativeTime(session.createdAt)}
                {session.updatedAt !== session.createdAt && ` · updated ${relativeTime(session.updatedAt)}`}
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href={`/sessions/${session.id}`}
                  className="flex-1 text-center text-xs font-medium px-3 py-1.5 rounded-md bg-indigo-400/[0.08] border border-indigo-400/20 text-indigo-300 hover:bg-indigo-400/[0.14] hover:text-indigo-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
                >
                  View
                </Link>
                <SessionDeleteButton sessionId={session.id} />
              </div>
            </div>
          )
        })}
      </div>
    </main>
  )
}
