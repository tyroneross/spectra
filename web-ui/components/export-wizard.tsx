'use client'

import { useState, useCallback } from 'react'
import type { Capture, ExportCapture, ExportRequest } from '@/lib/types'
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

interface ExportResult {
  outputPath: string
  fileCount: number
  totalSize: number
}

export function ExportWizard({ captures, preselectedIds = [] }: ExportWizardProps) {
  const [step, setStep] = useState<Step>(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(preselectedIds))
  const [captions, setCaptions] = useState<Record<string, string>>({})
  const [annotateIndex, setAnnotateIndex] = useState(0)
  const [format, setFormat] = useState<ExportRequest['format']>('markdown')
  const [template, setTemplate] = useState<ExportRequest['template']>('blog')
  const [outputDir, setOutputDir] = useState('spectra-export')
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
      outputDir,
      captures: exportCaptures,
    }

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
          Click captures to select them for export. {selectedIds.size > 0 && (
            <span className="text-zinc-200 font-medium">{selectedIds.size} selected</span>
          )}
        </p>

        {captures.length === 0 ? (
          <div className="py-16 text-center text-sm text-zinc-500">
            No captures available. Take some screenshots first.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {captures.map((capture) => {
              const isSelected = selectedIds.has(capture.id)
              return (
                <button
                  key={capture.id}
                  type="button"
                  onClick={() => toggleCapture(capture.id)}
                  className={cn(
                    'relative group rounded-lg overflow-hidden border transition-all text-left',
                    isSelected
                      ? 'border-zinc-300 ring-1 ring-zinc-300'
                      : 'border-zinc-800 hover:border-zinc-600'
                  )}
                >
                  <div style={{ aspectRatio: '16/10' }}>
                    {capture.type === 'video' ? (
                      <video
                        src={`/api/media/${capture.path}`}
                        className="w-full h-full object-cover bg-zinc-950"
                        preload="metadata"
                        muted
                      />
                    ) : (
                      <img
                        src={`/api/media/${capture.path}`}
                        alt={capture.filename}
                        className="w-full h-full object-cover bg-zinc-950"
                        loading="lazy"
                      />
                    )}
                  </div>

                  {/* Checkmark overlay */}
                  {isSelected && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-zinc-50 rounded-full flex items-center justify-center">
                      <svg className="w-3 h-3 text-zinc-950" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}

                  <div className="px-2 py-1.5 bg-zinc-900">
                    <p className="text-xs text-zinc-400 truncate">{capture.filename}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Selected list */}
        {selectedCaptures.length > 0 && (
          <div className="border border-zinc-800 rounded-lg p-3">
            <p className="text-xs font-medium text-zinc-400 mb-2">Selected order</p>
            <div className="space-y-1">
              {selectedCaptures.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-zinc-600 w-4 text-right">{i + 1}.</span>
                  <span className="text-zinc-300 truncate">{c.filename}</span>
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
              ? 'bg-zinc-50 text-zinc-950 hover:bg-zinc-200'
              : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}
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
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAnnotateIndex((i) => Math.min(selectedCaptures.length - 1, i + 1))}
              disabled={annotateIndex === selectedCaptures.length - 1}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              Next
            </Button>
          </div>
        </div>

        {/* Image */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
          {capture.type === 'video' ? (
            <video
              src={`/api/media/${capture.path}`}
              className="w-full max-h-[60vh] object-contain"
              controls
              muted
            />
          ) : (
            <img
              src={`/api/media/${capture.path}`}
              alt={capture.filename}
              className="w-full max-h-[60vh] object-contain"
            />
          )}
        </div>

        {/* Caption */}
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">Caption</label>
          <Input
            value={captions[capture.id] ?? ''}
            onChange={(e) => setCaptions((prev) => ({ ...prev, [capture.id]: e.target.value }))}
            placeholder={`Caption for ${capture.filename}`}
            className="bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500"
          />
        </div>

        {/* Annotation tools note */}
        <p className="text-xs text-zinc-600 italic">
          Annotation tools (crop, highlight) coming soon.
        </p>

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => setStep(1)}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            Back
          </Button>
          <Button
            onClick={() => setStep(3)}
            className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
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
          <div className="bg-green-950/30 border border-green-700/40 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm font-medium text-green-300">Export complete</span>
            </div>
            <div className="space-y-1 text-sm">
              <p className="text-zinc-300">
                <span className="text-zinc-500">Output:</span>{' '}
                <code className="font-mono text-xs bg-zinc-900 px-1 py-0.5 rounded">{result.outputPath}</code>
              </p>
              <p className="text-zinc-300">
                <span className="text-zinc-500">Files:</span> {result.fileCount}
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            onClick={() => { setResult(null); setStep(1); setSelectedIds(new Set()) }}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            Start New Export
          </Button>
        </div>
      )
    }

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Format */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Format</label>
            <div className="space-y-2">
              {(
                [
                  { value: 'markdown', label: 'Markdown', description: 'MD file with embedded images' },
                  { value: 'zip', label: 'ZIP (tar.gz)', description: 'Compressed archive' },
                  { value: 'individual', label: 'Individual files', description: 'Flat folder of images' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                    format === opt.value
                      ? 'border-zinc-400 bg-zinc-800'
                      : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                  )}
                >
                  <input
                    type="radio"
                    name="format"
                    value={opt.value}
                    checked={format === opt.value}
                    onChange={() => setFormat(opt.value)}
                    className="mt-0.5 accent-white"
                  />
                  <div>
                    <p className="text-sm text-zinc-200">{opt.label}</p>
                    <p className="text-xs text-zinc-500">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {/* Template */}
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Template</label>
              <Select value={template ?? 'blog'} onValueChange={(v) => setTemplate(v as ExportRequest['template'])}>
                <SelectTrigger className="bg-zinc-950 border-zinc-700 text-zinc-100 focus:border-zinc-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="blog" className="text-zinc-100 focus:bg-zinc-800">Blog Post</SelectItem>
                  <SelectItem value="social" className="text-zinc-100 focus:bg-zinc-800">Social Card</SelectItem>
                  <SelectItem value="docs" className="text-zinc-100 focus:bg-zinc-800">Documentation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Output dir */}
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Output directory</label>
              <Input
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="spectra-export/"
                className="bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500"
              />
            </div>

            {/* Summary */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-400 space-y-1">
              <p>{selectedCaptures.length} capture{selectedCaptures.length !== 1 ? 's' : ''} selected</p>
              <p>{Object.values(captions).filter(Boolean).length} caption{Object.values(captions).filter(Boolean).length !== 1 ? 's' : ''} added</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-950/30 border border-red-700/40 rounded-lg p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => setStep(2)}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            Back
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting}
            className={!exporting ? 'bg-zinc-50 text-zinc-950 hover:bg-zinc-200' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}
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
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                step === s
                  ? 'bg-zinc-50 text-zinc-950'
                  : step > s
                  ? 'bg-zinc-700 text-zinc-300'
                  : 'bg-zinc-800 text-zinc-500'
              )}
            >
              {s}
            </div>
            <span
              className={cn(
                'text-sm',
                step === s ? 'text-zinc-200 font-medium' : 'text-zinc-500'
              )}
            >
              {stepLabels[s]}
            </span>
            {s < 3 && <span className="text-zinc-700 mx-1">›</span>}
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
