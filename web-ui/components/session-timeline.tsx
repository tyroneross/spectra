'use client'

import type { DashboardStep } from '@/lib/types'
import { Badge } from '@/components/ui/badge'

interface SessionTimelineProps {
  steps: DashboardStep[]
}

const ACTION_COLOR: Record<string, string> = {
  click: 'text-blue-400',
  type: 'text-green-400',
  scroll: 'text-yellow-400',
}

function actionColorClass(actionType: string): string {
  return ACTION_COLOR[actionType.toLowerCase()] ?? 'text-zinc-400'
}

export function SessionTimeline({ steps }: SessionTimelineProps) {
  if (steps.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-zinc-500">
        No steps recorded for this session.
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-white/[0.06]" />

      <div className="space-y-4">
        {steps.map((step) => {
          const label = step.intent ?? `${step.actionType} on ${step.elementId || 'unknown'}`

          return (
            <div key={step.index} className="relative flex gap-4 pl-12">
              {/* Step circle on the line */}
              <div className="absolute left-0 top-1 w-8 h-8 rounded-full bg-white/[0.025] border border-white/[0.08] flex items-center justify-center shrink-0 z-10">
                <span className="text-xs font-mono text-zinc-400">{step.index + 1}</span>
              </div>

              {/* Card */}
              <div className="flex-1 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 min-w-0">
                <div className="flex items-start gap-3">
                  {/* Thumbnail */}
                  {step.screenshotPath && (
                    <img
                      src={`/api/media/${step.screenshotPath}`}
                      alt={`Step ${step.index + 1}`}
                      className="w-[120px] shrink-0 rounded-lg border border-white/[0.06] object-cover"
                      loading="lazy"
                    />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      {/* Action type */}
                      <span
                        className={[
                          'text-xs font-medium',
                          actionColorClass(step.actionType),
                        ].join(' ')}
                      >
                        {step.actionType}
                      </span>

                      {/* Success/failure */}
                      {step.success ? (
                        <span title="Success">
                          <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      ) : (
                        <span title="Failed">
                          <svg className="w-3.5 h-3.5 text-rose-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </span>
                      )}
                    </div>

                    {/* Intent / fallback label */}
                    <p className="text-[13px] font-medium text-zinc-100 leading-snug break-words">{label}</p>

                    {/* Duration */}
                    <p className="text-[11px] text-zinc-500 mt-1">{step.duration}ms</p>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
