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
      {/* Back nav */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-zinc-800 shrink-0">
          <Link
            href="/captures"
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Captures
          </Link>
          <span className="text-zinc-700">/</span>
          <span className="text-sm font-mono text-zinc-300 truncate">{capture.filename}</span>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Media viewer */}
          <main className="flex-1 min-w-0 p-6">
            <MediaViewer capture={capture} />
          </main>

          {/* Metadata sidebar */}
          <aside className="w-72 shrink-0 border-l border-zinc-800 p-6 overflow-y-auto flex flex-col gap-6">
            {/* File info */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">File</p>
              <div className="space-y-2">
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Filename</p>
                  <p className="text-sm font-mono text-zinc-200 break-all">{capture.filename}</p>
                </div>
                {capture.dimensions && (
                  <div>
                    <p className="text-xs text-zinc-500 mb-0.5">Dimensions</p>
                    <p className="text-sm text-zinc-300">
                      {capture.dimensions[0]} × {capture.dimensions[1]}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Size</p>
                  <p className="text-sm text-zinc-300">{formatBytes(capture.size)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Format</p>
                  <p className="text-sm text-zinc-300 uppercase">{capture.format}</p>
                </div>
              </div>
            </div>

            {/* Session / source */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Source</p>
              <div className="space-y-2">
                {capture.sessionId && capture.sessionName && (
                  <div>
                    <p className="text-xs text-zinc-500 mb-0.5">Session</p>
                    <Link
                      href={`/sessions/${capture.sessionId}`}
                      className="text-sm text-zinc-300 hover:text-zinc-100 underline underline-offset-2 decoration-zinc-700 hover:decoration-zinc-500 transition-colors"
                    >
                      {capture.sessionName}
                    </Link>
                  </div>
                )}
                {!capture.sessionId && (
                  <div>
                    <p className="text-xs text-zinc-500 mb-0.5">Source</p>
                    <p className="text-sm text-zinc-300">Artifacts</p>
                  </div>
                )}
                {capture.platform && (
                  <div>
                    <p className="text-xs text-zinc-500 mb-0.5">Platform</p>
                    <span className="inline-flex items-center text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                      {PLATFORM_LABELS[capture.platform] ?? capture.platform}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Timestamp */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Captured</p>
              <div>
                <p className="text-sm text-zinc-300">{fullDate}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{relativeTime(capture.timestamp)}</p>
              </div>
            </div>

            {/* Actions */}
            <CaptureActions capture={capture} />
          </aside>
        </div>
      </div>
    </div>
  )
}
