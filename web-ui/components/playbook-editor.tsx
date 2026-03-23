'use client'

import { useState, useRef } from 'react'
import type { Playbook, PlaybookStep } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface PlaybookEditorProps {
  playbook: Playbook
  onSave: (p: Playbook) => void
}

const CAPTURE_TYPE_OPTIONS: { value: PlaybookStep['captureType']; label: string }[] = [
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'video_start', label: 'Video Start' },
  { value: 'video_stop', label: 'Video Stop' },
  { value: 'none', label: 'None' },
]

const PLATFORM_OPTIONS = [
  { value: 'web', label: 'Web' },
  { value: 'macos', label: 'macOS' },
  { value: 'ios', label: 'iOS' },
  { value: 'watchos', label: 'watchOS' },
]

export function PlaybookEditor({ playbook, onSave }: PlaybookEditorProps) {
  const [name, setName] = useState(playbook.name)
  const [description, setDescription] = useState(playbook.description)
  const [target, setTarget] = useState(playbook.target)
  const [platform, setPlatform] = useState<string>(playbook.platform)
  const [steps, setSteps] = useState<PlaybookStep[]>(playbook.steps)

  // Drag state
  const dragIndex = useRef<number | null>(null)

  function addStep() {
    setSteps((prev) => [...prev, { intent: '', captureType: 'screenshot', notes: '' }])
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateStep(idx: number, patch: Partial<PlaybookStep>) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  function handleDragStart(idx: number) {
    dragIndex.current = idx
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    const from = dragIndex.current
    if (from === null || from === idx) return
    setSteps((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(idx, 0, moved)
      return next
    })
    dragIndex.current = idx
  }

  function handleDragEnd() {
    dragIndex.current = null
  }

  function handleSave() {
    onSave({
      ...playbook,
      name,
      description,
      target,
      platform: platform as Playbook['platform'],
      steps,
      updatedAt: Date.now(),
    })
  }

  const isDirty =
    name !== playbook.name ||
    description !== playbook.description ||
    target !== playbook.target ||
    platform !== playbook.platform ||
    JSON.stringify(steps) !== JSON.stringify(playbook.steps)

  return (
    <div className="space-y-6">
      {/* Header fields */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
        <h2 className="text-sm font-medium text-zinc-300">Playbook Details</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Onboarding flow"
              className="bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Platform</label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="bg-zinc-950 border-zinc-700 text-zinc-100 focus:border-zinc-500">
                <SelectValue placeholder="Select platform" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {PLATFORM_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-zinc-100 focus:bg-zinc-800">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Target</label>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g., https://app.example.com or MyApp"
              className="bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this playbook"
              className="bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500"
            />
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-zinc-300">Steps ({steps.length})</h2>
        </div>

        {steps.length === 0 && (
          <p className="text-sm text-zinc-500 py-4 text-center">
            No steps yet. Add your first step below.
          </p>
        )}

        <div className="space-y-2">
          {steps.map((step, idx) => (
            <div
              key={idx}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className="flex items-start gap-2 bg-zinc-950 border border-zinc-800 rounded-lg p-3 cursor-default"
            >
              {/* Drag handle */}
              <div
                className="mt-2 shrink-0 text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing select-none"
                title="Drag to reorder"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="9" cy="5" r="1.5" />
                  <circle cx="15" cy="5" r="1.5" />
                  <circle cx="9" cy="12" r="1.5" />
                  <circle cx="15" cy="12" r="1.5" />
                  <circle cx="9" cy="19" r="1.5" />
                  <circle cx="15" cy="19" r="1.5" />
                </svg>
              </div>

              {/* Step number */}
              <div className="mt-2 w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                <span className="text-xs text-zinc-400">{idx + 1}</span>
              </div>

              {/* Fields */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input
                  value={step.intent}
                  onChange={(e) => updateStep(idx, { intent: e.target.value })}
                  placeholder="e.g., click the settings button"
                  className="sm:col-span-1 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 text-sm h-8 focus:border-zinc-500"
                />

                <Select
                  value={step.captureType}
                  onValueChange={(v) => updateStep(idx, { captureType: v as PlaybookStep['captureType'] })}
                >
                  <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-100 h-8 text-sm focus:border-zinc-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {CAPTURE_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-zinc-100 focus:bg-zinc-800 text-sm">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  value={step.notes ?? ''}
                  onChange={(e) => updateStep(idx, { notes: e.target.value })}
                  placeholder="Notes (optional)"
                  className="bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 text-sm h-8 focus:border-zinc-500"
                />
              </div>

              {/* Delete */}
              <button
                onClick={() => removeStep(idx)}
                className="mt-1.5 shrink-0 text-zinc-600 hover:text-red-400 transition-colors"
                title="Remove step"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={addStep}
          className="mt-3 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          + Add Step
        </Button>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={!isDirty || !name.trim()}
          className={isDirty && name.trim() ? 'bg-zinc-50 text-zinc-950 hover:bg-zinc-200' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}
        >
          Save Playbook
        </Button>
      </div>
    </div>
  )
}
