import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getCapture } from '@/lib/data'
import { formatBytes, relativeTime } from '@/lib/utils'
import { MediaViewer } from '@/components/media-viewer'
import { CaptureActions } from '@/components/capture-actions'

interface PageProps {
  params: Promise<{ id: string }>
}

const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  macos: 'macOS',
  ios: 'iOS',
  watchos: 'watchOS',
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">{label}</p>
      <div className="text-sm text-zinc-200">{children}</div>
    </div>
  )
}

export default async function CaptureDetailPage({ params }: PageProps) {
  const { id } = await params
  const capture = await getCapture(id)

  if (!capture) notFound()

  const fullDate = new Date(capture.timestamp).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.08] shrink-0">
          <Link
            href="/captures"
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 rounded"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Captures
          </Link>
          <span className="text-zinc-700">/</span>
          <span className="text-sm font-mono text-zinc-400 truncate">{capture.filename}</span>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Media viewer — hero */}
          <main className="flex-1 min-w-0 p-6">
            <MediaViewer capture={capture} />
          </main>

          {/* Metadata sidebar */}
          <aside className="w-72 shrink-0 border-l border-white/[0.08] p-6 overflow-y-auto flex flex-col gap-5">
            {/* L1 title */}
            <h1 className="text-2xl font-bold text-zinc-50 break-all leading-snug">
              {capture.filename}
            </h1>

            {/* Metadata — one bordered container, dividers between rows */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] overflow-hidden divide-y divide-white/[0.06]">
              {capture.dimensions && (
                <MetaRow label="Dimensions">
                  {capture.dimensions[0]} × {capture.dimensions[1]}
                </MetaRow>
              )}
              <MetaRow label="Size">{formatBytes(capture.size)}</MetaRow>
              <MetaRow label="Format">
                <span className="uppercase">{capture.format}</span>
              </MetaRow>
              {capture.projectName && (
                <MetaRow label="Project">{capture.projectName}</MetaRow>
              )}
              {capture.sessionId && capture.sessionName && (
                <MetaRow label="Session">
                  <Link
                    href={`/sessions/${capture.sessionId}`}
                    className="hover:text-zinc-50 underline underline-offset-2 decoration-white/20 hover:decoration-white/40 transition-colors"
                  >
                    {capture.sessionName}
                  </Link>
                </MetaRow>
              )}
              {capture.sessionType && (
                <MetaRow label="Session Type">{capture.sessionType}</MetaRow>
              )}
              {!capture.sessionId && (
                <MetaRow label="Source">Artifacts</MetaRow>
              )}
              {capture.repoName && (
                <MetaRow label="Repo">
                  <span className="font-mono">{capture.repoName}</span>
                </MetaRow>
              )}
              {capture.platform && (
                <MetaRow label="Platform">
                  {PLATFORM_LABELS[capture.platform] ?? capture.platform}
                </MetaRow>
              )}
              {capture.guide && (
                <MetaRow label="Instruction">
                  <span className="leading-5">{capture.guide}</span>
                </MetaRow>
              )}
              <MetaRow label="Captured">
                {fullDate}
                <span className="text-[11px] text-zinc-500 block mt-0.5">
                  {relativeTime(capture.timestamp)}
                </span>
              </MetaRow>
            </div>

            {/* Rebuild Guide — separate section, can be long */}
            {capture.guideDetails && capture.guideDetails.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2 px-1">
                  Rebuild Guide
                </p>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 space-y-1.5">
                  {capture.guideDetails.map((detail) => (
                    <p key={detail} className="break-words text-xs leading-5 text-zinc-400">
                      {detail}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <CaptureActions capture={capture} />
          </aside>
        </div>
      </div>
    </div>
  )
}
