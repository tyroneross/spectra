import Link from 'next/link'
import { listPlaybooks } from '@/lib/data'
import { relativeTime } from '@/lib/utils'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'

const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  macos: 'macOS',
  ios: 'iOS',
  watchos: 'watchOS',
}

export default async function GuidancePage() {
  const playbooks = await listPlaybooks()

  if (playbooks.length === 0) {
    return (
      <main className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold text-zinc-50">Guidance</h1>
          <Link href="/guidance/new">
            <Button size="sm" className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200">
              New Playbook
            </Button>
          </Link>
        </div>
        <EmptyState
          icon={
            <svg className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
          title="No playbooks yet"
          description="Create your first capture playbook to automate screenshot flows."
          action={
            <Link href="/guidance/new">
              <Button className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200">
                Create Playbook
              </Button>
            </Link>
          }
        />
      </main>
    )
  }

  return (
    <main className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-zinc-50">
          Guidance
          <span className="ml-2 text-sm font-normal text-zinc-500">{playbooks.length}</span>
        </h1>
        <Link href="/guidance/new">
          <Button size="sm" className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200">
            New Playbook
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {playbooks.map((playbook) => (
          <Link key={playbook.id} href={`/guidance/${playbook.id}`} className="group block">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors h-full">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-medium text-zinc-100 group-hover:text-zinc-50 transition-colors leading-snug">
                  {playbook.name}
                </p>
                <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
                  {PLATFORM_LABELS[playbook.platform] ?? playbook.platform}
                </span>
              </div>

              {playbook.description && (
                <p className="text-xs text-zinc-500 line-clamp-2 mb-3">{playbook.description}</p>
              )}

              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span>{playbook.steps.length} step{playbook.steps.length !== 1 ? 's' : ''}</span>
                {playbook.target && (
                  <>
                    <span>·</span>
                    <span className="truncate max-w-[140px]">{playbook.target}</span>
                  </>
                )}
              </div>

              {playbook.lastRunAt && (
                <p className="text-xs text-zinc-600 mt-2">
                  Last run {relativeTime(playbook.lastRunAt)}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </main>
  )
}
