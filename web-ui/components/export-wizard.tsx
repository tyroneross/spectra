'use client'

import { useState, useCallback } from 'react'
import type { Capture, ExportCapture, ExportRequest, ExportResult } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface ExportWizardProps {
  captures: Capture[]
  preselectedIds?: string[]
}

type Step = 1 | 2 | 3

export function ExportWizard({ captures, preselectedIds = [] }: ExportWizardProps) {
  const [step, setStep] = useState<Step>(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(preselectedIds))
  const [captions, setCaptions] = useState<Record<string, string>>({})
  const [annotateIndex, setAnnotateIndex] = useState(0)
  const [format, setFormat] = useState<ExportRequest['format']>('markdown')
  const [template, setTemplate] = useState<ExportRequest['template']>('blog')
  const [outputDir, setOutputDir] = useState('')
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedCaptures = captures.filter((c) => selectedIds.has(c.id))

  function toggleCapture(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleExport() {
    setExporting(true)
    setError(null)

    const exportCaptures: ExportCapture[] = selectedCaptures.map((c, i) => ({
      captureId: c.id,
      order: i + 1,
      caption: captions[c.id] ?? '',
    }))

    const body: ExportRequest = {
      format,
      template,
      captures: exportCaptures,
    }
    const trimmedOutputDir = outputDir.trim()
    if (trimmedOutputDir) body.outputDir = trimmedOutputDir

    fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error as string)
        } else {
          setResult(data as ExportResult)
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Export failed')
      })
      .finally(() => {
        setExporting(false)
      })
  }

  // ── Step 1: Select captures ──────────────────────────────────────────────
  function renderStep1() {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">
          Click captures to select them for export.{' '}
          {selectedIds.size > 0 && (
            <span className="font-medium text-zinc-200">{selectedIds.size} selected</span>
          )}
        </p>

        {captures.length === 0 ? (
          <div className="py-16 text-center text-sm text-zinc-500">
            No captures available. Take some screenshots first.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {captures.map((capture) => {
              const isSelected = selectedIds.has(capture.id)
              return (
                <button
                  key={capture.id}
                  type="button"
                  onClick={() => toggleCapture(capture.id)}
                  className={cn(
                    'group relative overflow-hidden rounded-xl border text-left transition-all duration-200 ease-out',
                    isSelected
                      ? 'border-indigo-400/70 bg-indigo-400/[0.04] ring-1 ring-indigo-400/40'
                      : 'border-white/[0.06] bg-white/[0.025] hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.045] hover:shadow-xl hover:shadow-black/50'
                  )}
                >
                  <div className="relative aspect-[16/10] overflow-hidden border-b border-white/[0.06] bg-black/50">
                    {capture.type === 'video' ? (
                      <video
                        src={`/api/media/${capture.path}`}
                        className="h-full w-full object-cover"
                        preload="metadata"
                        muted
                      />
                    ) : (
                      <img
                        src={`/api/media/${capture.path}`}
                        alt={capture.filename}
                        className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                    )}

                    {/* Checkmark overlay */}
                    {isSelected && (
                      <div className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-indigo-500">
                        <svg className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="px-2 py-1.5">
                    <p className="truncate text-[11px] text-zinc-400">{capture.filename}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Selected list */}
        {selectedCaptures.length > 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Selected order</p>
            <div className="space-y-1">
              {selectedCaptures.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2 text-sm">
                  <span className="w-4 text-right text-[11px] text-zinc-600">{i + 1}.</span>
                  <span className="truncate text-[13px] text-zinc-300">{c.filename}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => { setAnnotateIndex(0); setStep(2) }}
            disabled={selectedCaptures.length === 0}
            className={selectedCaptures.length > 0
              ? 'bg-indigo-500 text-white hover:bg-indigo-400'
              : 'cursor-not-allowed bg-white/[0.04] text-zinc-600'}
          >
            Next: Annotate
          </Button>
        </div>
      </div>
    )
  }

  // ── Step 2: Annotate ─────────────────────────────────────────────────────
  function renderStep2() {
    const capture = selectedCaptures[annotateIndex]
    if (!capture) return null

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-400">
            {annotateIndex + 1} / {selectedCaptures.length}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAnnotateIndex((i) => Math.max(0, i - 1))}
              disabled={annotateIndex === 0}
              className="border-white/[0.08] text-zinc-300 hover:bg-white/[0.04]"
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAnnotateIndex((i) => Math.min(selectedCaptures.length - 1, i + 1))}
              disabled={annotateIndex === selectedCaptures.length - 1}
              className="border-white/[0.08] text-zinc-300 hover:bg-white/[0.04]"
            >
              Next
            </Button>
          </div>
        </div>

        {/* Media preview */}
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/50">
          {capture.type === 'video' ? (
            <video
              src={`/api/media/${capture.path}`}
              className="max-h-[60vh] w-full object-contain"
              controls
              muted
            />
          ) : (
            <img
              src={`/api/media/${capture.path}`}
              alt={capture.filename}
              className="max-h-[60vh] w-full object-contain"
            />
          )}
        </div>

        {/* Caption */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Caption</label>
          <Input
            value={captions[capture.id] ?? ''}
            onChange={(e) => setCaptions((prev) => ({ ...prev, [capture.id]: e.target.value }))}
            placeholder={`Caption for ${capture.filename}`}
            className="border-white/[0.08] bg-white/[0.025] text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-400/60 focus-visible:ring-2 focus-visible:ring-indigo-400/60"
          />
        </div>

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => setStep(1)}
            className="min-h-11 border-white/[0.08] text-zinc-300 hover:bg-white/[0.04] sm:min-h-9"
          >
            Back
          </Button>
          <Button
            onClick={() => setStep(3)}
            className="min-h-11 bg-indigo-500 text-white hover:bg-indigo-400 sm:min-h-9"
          >
            Next: Export
          </Button>
        </div>
      </div>
    )
  }

  // ── Step 3: Export options ───────────────────────────────────────────────
  function renderStep3() {
    if (result) {
      return (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
            <div className="mb-3 flex items-center gap-2">
              <svg className="size-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm font-medium text-emerald-300">Export complete</span>
            </div>
            <div className="space-y-1 text-sm">
              <p className="text-zinc-300">
                <span className="text-zinc-500">Output:</span>{' '}
                <code className="rounded bg-white/[0.04] px-1 py-0.5 font-mono text-xs">{result.outputPath}</code>
              </p>
              <p className="text-zinc-300">
                <span className="text-zinc-500">Files:</span> {result.fileCount}
              </p>
              {result.quality && (
                <p className="text-zinc-300">
                  <span className="text-zinc-500">Quality:</span>{' '}
                  {result.quality.status} ({result.quality.score}/100)
                </p>
              )}
              {result.manifestPath && (
                <p className="text-zinc-300">
                  <span className="text-zinc-500">Manifest:</span>{' '}
                  <code className="rounded bg-white/[0.04] px-1 py-0.5 font-mono text-xs">{result.manifestPath}</code>
                </p>
              )}
              {result.warnings && result.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
                  <p className="mb-1 text-xs font-medium">
                    {result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}
                  </p>
                  <ul className="space-y-1 text-xs">
                    {result.warnings.slice(0, 4).map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                  {result.warnings.length > 4 && (
                    <p className="mt-1 text-xs text-amber-300/80">
                      {result.warnings.length - 4} more
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            onClick={() => { setResult(null); setStep(1); setSelectedIds(new Set()) }}
            className="min-h-11 border-white/[0.08] text-zinc-300 hover:bg-white/[0.04] sm:min-h-9"
          >
            Start New Export
          </Button>
        </div>
      )
    }

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Format */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Format</p>
            <div className="space-y-2">
              {(
                [
                  { value: 'markdown', label: 'Markdown', description: 'MD file with embedded images' },
                  { value: 'zip', label: 'ZIP (tar.gz)', description: 'Compressed archive' },
                  { value: 'individual', label: 'Individual files', description: 'Flat folder of images' },
                  { value: 'production', label: 'Production bundle', description: 'Masters, derivatives, manifest, quality report' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all duration-200 ease-out',
                    format === opt.value
                      ? 'border-indigo-400/70 bg-indigo-400/[0.04]'
                      : 'border-white/[0.06] bg-white/[0.025] hover:border-white/[0.12] hover:bg-white/[0.045]'
                  )}
                >
                  <input
                    type="radio"
                    name="format"
                    value={opt.value}
                    checked={format === opt.value}
                    onChange={() => setFormat(opt.value)}
                    className="mt-0.5 accent-indigo-400"
                  />
                  <div>
                    <p className="text-[13px] font-medium text-zinc-200">{opt.label}</p>
                    <p className="text-[11px] text-zinc-500">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {/* Template */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Template</p>
              <Select value={template ?? 'blog'} onValueChange={(v) => setTemplate(v as ExportRequest['template'])}>
                <SelectTrigger className="border-white/[0.08] bg-white/[0.025] text-zinc-100 focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-400/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/[0.08] bg-zinc-950">
                  <SelectItem value="blog" className="text-zinc-100 focus:bg-white/[0.04]">Blog Post</SelectItem>
                  <SelectItem value="social" className="text-zinc-100 focus:bg-white/[0.04]">Social Card</SelectItem>
                  <SelectItem value="docs" className="text-zinc-100 focus:bg-white/[0.04]">Documentation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Output dir */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Output directory</p>
              <Input
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="spectra-export/"
                className="border-white/[0.08] bg-white/[0.025] font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-400/60 focus-visible:ring-2 focus-visible:ring-indigo-400/60"
              />
            </div>

            {/* Summary */}
            <div className="space-y-1 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 text-[11px] text-zinc-400">
              <p>{selectedCaptures.length} capture{selectedCaptures.length !== 1 ? 's' : ''} selected</p>
              <p>{Object.values(captions).filter(Boolean).length} caption{Object.values(captions).filter(Boolean).length !== 1 ? 's' : ''} added</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-400/20 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => setStep(2)}
            className="min-h-11 border-white/[0.08] text-zinc-300 hover:bg-white/[0.04] sm:min-h-9"
          >
            Back
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting}
            className={!exporting
              ? 'min-h-11 bg-indigo-500 text-white hover:bg-indigo-400 sm:min-h-9'
              : 'min-h-11 cursor-not-allowed bg-white/[0.04] text-zinc-600 sm:min-h-9'}
          >
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </div>
    )
  }

  const stepLabels: Record<Step, string> = {
    1: 'Select',
    2: 'Annotate',
    3: 'Export',
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {([1, 2, 3] as Step[]).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs font-medium',
                step === s
                  ? 'bg-indigo-500/80 text-white'
                  : step > s
                  ? 'bg-white/[0.08] text-zinc-400'
                  : 'border border-white/[0.06] bg-white/[0.025] text-zinc-600'
              )}
            >
              {s}
            </div>
            <span
              className={cn(
                'text-sm',
                step === s ? 'font-medium text-zinc-100' : 'text-zinc-500'
              )}
            >
              {stepLabels[s]}
            </span>
            {s < 3 && <span className="mx-1 text-zinc-700">›</span>}
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
    </div>
  )
}
