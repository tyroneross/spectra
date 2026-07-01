import Link from 'next/link'
import { listPlaybookRecommendations, listPlaybooks } from '@/lib/data'
import { relativeTime } from '@/lib/utils'
import { EmptyState } from '@/components/empty-state'
import { PlaybookRecommendations } from '@/components/playbook-recommendations'
import { Button } from '@/components/ui/button'

const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  macos: 'macOS',
  ios: 'iOS',
  watchos: 'watchOS',
}

export const dynamic = 'force-dynamic'

export default async function GuidancePage() {
  const [playbooks, recommendations] = await Promise.all([
    listPlaybooks(),
    listPlaybookRecommendations(),
  ])

  return (
    <main className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-50">
          Guidance
          <span className="ml-2 text-sm font-normal text-zinc-500">{playbooks.length}</span>
        </h1>
        <Button asChild size="sm" className="bg-indigo-500 hover:bg-indigo-400 text-white border-0">
          <Link href="/guidance/new">New Playbook</Link>
        </Button>
      </div>

      <PlaybookRecommendations recommendations={recommendations} />

      {playbooks.length === 0 && recommendations.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
          title="No playbooks yet"
          description="Create your first capture playbook to automate screenshot flows."
          action={
            <Button asChild className="bg-indigo-500 hover:bg-indigo-400 text-white border-0">
              <Link href="/guidance/new">Create Playbook</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {playbooks.map((playbook) => (
            <Link
              key={playbook.id}
              href={`/guidance/${playbook.id}`}
              className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
            >
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 h-full transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.045] hover:shadow-xl hover:shadow-black/50">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-[13px] font-medium text-zinc-100 leading-snug">
                    {playbook.name}
                  </p>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md border border-white/[0.08] bg-white/[0.04] text-zinc-400 shrink-0">
                    {PLATFORM_LABELS[playbook.platform] ?? playbook.platform}
                  </span>
                </div>

                {playbook.description && (
                  <p className="text-xs text-zinc-500 line-clamp-2 mb-3">{playbook.description}</p>
                )}

                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  <span>{playbook.steps.length} step{playbook.steps.length !== 1 ? 's' : ''}</span>
                  {playbook.target && (
                    <>
                      <span>·</span>
                      <span className="truncate max-w-[140px]">{playbook.target}</span>
                    </>
                  )}
                </div>

                {playbook.lastRunAt && (
                  <p className="text-[11px] text-zinc-500 mt-2">
                    Last run {relativeTime(playbook.lastRunAt)}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
