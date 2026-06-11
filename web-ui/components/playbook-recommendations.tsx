'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, Sparkles } from 'lucide-react'
import type { Playbook, PlaybookRecommendation, PlaybookStep } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn, relativeTime } from '@/lib/utils'

interface PlaybookRecommendationsProps {
  recommendations: PlaybookRecommendation[]
}

const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  macos: 'macOS',
  ios: 'iOS',
  watchos: 'watchOS',
  terminal: 'Terminal',
}

function captureTypeLabel(captureType: PlaybookStep['captureType']): string {
  switch (captureType) {
    case 'screenshot':
      return 'Screenshot after step'
    case 'video_start':
      return 'Start recording'
    case 'video_stop':
      return 'Stop recording'
    case 'none':
      return 'No capture'
  }
}

function toolsForStep(step: PlaybookStep): string {
  const tools = ['spectra_step']
  if (step.captureType !== 'none') tools.push('spectra_capture')
  return tools.join(' -> ')
}

export function PlaybookRecommendations({ recommendations }: PlaybookRecommendationsProps) {
  const router = useRouter()
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (recommendations.length === 0) return null

  async function acceptRecommendation(recommendation: PlaybookRecommendation) {
    setAcceptingId(recommendation.id)
    setError(null)

    try {
      const res = await fetch('/api/playbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: recommendation.name,
          description: recommendation.description,
          target: recommendation.target,
          platform: recommendation.platform,
          steps: recommendation.steps,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Recommendation accept failed')
      }

      const saved = await res.json() as Playbook
      router.push(`/guidance/${saved.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recommendation accept failed')
    } finally {
      setAcceptingId(null)
    }
  }

  return (
    <section className="mb-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-indigo-300" aria-hidden="true" />
          <h2 className="text-sm font-medium text-zinc-200">Recommended Playbooks</h2>
          <span className="text-xs text-zinc-600">{recommendations.length}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {recommendations.map((recommendation) => {
          const isExpanded = expandedId === recommendation.id
          const detailsId = `recommendation-details-${recommendation.id}`
          const toolPaths = [...new Set(recommendation.steps.map(toolsForStep))].join(', ')

          return (
            <article
              key={recommendation.id}
              className="rounded-lg border border-indigo-400/20 bg-zinc-900/80 p-4 transition-colors hover:border-indigo-300/30"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-zinc-50">{recommendation.name}</h3>
                    <span className="rounded-full border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-xs text-zinc-400">
                      {PLATFORM_LABELS[recommendation.platform] ?? recommendation.platform}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {recommendation.occurrences} runs · {recommendation.steps.length} steps · {Math.round(recommendation.confidence * 100)}% confidence
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-controls={detailsId}
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedId(isExpanded ? null : recommendation.id)}
                    className="min-h-9 border-zinc-700 bg-zinc-950/40 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
                  >
                    Learn more
                    <ChevronDown
                      className={cn('size-4 transition-transform', isExpanded && 'rotate-180')}
                      aria-hidden="true"
                    />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => acceptRecommendation(recommendation)}
                    disabled={acceptingId === recommendation.id}
                    className="min-h-9 bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
                  >
                    <Check className="size-4" aria-hidden="true" />
                    {acceptingId === recommendation.id ? 'Accepting' : 'Accept'}
                  </Button>
                </div>
              </div>

              <ol className="mt-3 space-y-1">
                {recommendation.steps.slice(0, 4).map((step, index) => (
                  <li key={`${recommendation.id}:${index}:${step.intent}`} className="flex gap-2 text-xs text-zinc-400">
                    <span className="w-4 shrink-0 text-zinc-600">{index + 1}</span>
                    <span className="truncate">{step.intent}</span>
                  </li>
                ))}
              </ol>

              {isExpanded && (
                <div id={detailsId} className="mt-4 border-t border-zinc-800 pt-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(12rem,0.7fr)]">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                        How this was learned
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        Spectra found the same successful sequence in {recommendation.occurrences} sessions for this platform and target. The recommendation is built from matching step intents and capture types, then filtered against playbooks you already saved.
                      </p>
                      <dl className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-2 text-xs">
                        <dt className="text-zinc-600">Target</dt>
                        <dd className="truncate text-zinc-400">{recommendation.target || 'Not recorded'}</dd>
                        <dt className="text-zinc-600">Tool path</dt>
                        <dd className="text-zinc-400">{toolPaths || 'Not recorded'}</dd>
                        <dt className="text-zinc-600">Agent source</dt>
                        <dd className="text-zinc-400">Not recorded on this recommendation</dd>
                      </dl>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                        Evidence runs
                      </p>
                      <ul className="mt-2 space-y-2">
                        {recommendation.evidence.map((evidence) => (
                          <li key={`${recommendation.id}:${evidence.sessionId}`} className="text-xs">
                            <p className="truncate text-zinc-300">{evidence.sessionName}</p>
                            <p className="font-mono text-[11px] text-zinc-600">{evidence.sessionId}</p>
                            <p className="text-zinc-600">{relativeTime(evidence.updatedAt)}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Step details
                    </p>
                    <ol className="mt-2 divide-y divide-zinc-800">
                      {recommendation.steps.map((step, index) => (
                        <li key={`${recommendation.id}:detail:${index}:${step.intent}`} className="grid gap-1 py-2 text-xs sm:grid-cols-[1.5rem_minmax(0,1fr)_9rem_10rem] sm:items-center">
                          <span className="font-mono text-zinc-600">{index + 1}</span>
                          <span className="min-w-0 text-zinc-300">{step.intent}</span>
                          <span className="text-zinc-500">{captureTypeLabel(step.captureType)}</span>
                          <span className="font-mono text-[11px] text-zinc-600">{toolsForStep(step)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                <span>{relativeTime(recommendation.lastSeenAt)}</span>
                {recommendation.target && (
                  <>
                    <span>·</span>
                    <span className="max-w-[20rem] truncate">{recommendation.target}</span>
                  </>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
