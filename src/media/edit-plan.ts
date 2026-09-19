import { createHash } from 'node:crypto'
import { z } from 'zod'

const idSchema = z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Use letters, numbers, dots, underscores, or hyphens')

export const editPlanClaimSchema = z.object({
  id: idSchema,
  text: z.string().min(1),
  status: z.enum(['supported', 'qualified', 'blocked']),
  evidence: z.array(z.string().min(1)).default([]),
})

export const editPlanNarrationSchema = z.object({
  text: z.string().min(1),
  durationMs: z.number().int().positive(),
  voice: z.string().min(1).default('default'),
  rate: z.number().positive().default(1),
  engine: z.string().min(1).default('system'),
})

export const editPlanBeatSchema = z.object({
  id: idSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  keyMessage: z.string().min(1),
  description: z.string().min(1).optional(),
  claimIds: z.array(idSchema).default([]),
  caption: z.string().min(1).optional(),
  narration: editPlanNarrationSchema.optional(),
})

export const editPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  title: z.string().min(1),
  fps: z.number().int().min(1).max(120).default(30),
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  claims: z.array(editPlanClaimSchema).default([]),
  beats: z.array(editPlanBeatSchema).min(1),
}).superRefine((plan, context) => {
  const claimIds = new Set<string>()
  for (const [index, claim] of plan.claims.entries()) {
    if (claimIds.has(claim.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claims', index, 'id'],
        message: `Duplicate claim id: ${claim.id}`,
      })
    }
    claimIds.add(claim.id)
  }

  const claimsById = new Map(plan.claims.map((claim) => [claim.id, claim]))
  const beatIds = new Set<string>()
  let previousEndMs = 0

  for (const [index, beat] of plan.beats.entries()) {
    if (beatIds.has(beat.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beats', index, 'id'],
        message: `Duplicate beat id: ${beat.id}`,
      })
    }
    beatIds.add(beat.id)

    if (beat.endMs <= beat.startMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beats', index, 'endMs'],
        message: 'Beat endMs must be greater than startMs',
      })
    }
    if (index > 0 && beat.startMs < previousEndMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beats', index, 'startMs'],
        message: `Beat overlaps the previous beat ending at ${previousEndMs}ms`,
      })
    }
    previousEndMs = beat.endMs

    for (const claimId of beat.claimIds) {
      const claim = claimsById.get(claimId)
      if (!claim) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['beats', index, 'claimIds'],
          message: `Unknown claim id: ${claimId}`,
        })
      } else if (claim.status === 'blocked') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['beats', index, 'claimIds'],
          message: `Blocked claim cannot be used: ${claimId}`,
        })
      }
    }

    if (beat.narration && beat.narration.durationMs > beat.endMs - beat.startMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beats', index, 'narration', 'durationMs'],
        message: `Narration exceeds beat duration by ${beat.narration.durationMs - (beat.endMs - beat.startMs)}ms`,
      })
    }
  }
})

export type EditPlanInput = z.input<typeof editPlanSchema>
export type EditPlan = z.output<typeof editPlanSchema>
export type EditPlanClaim = z.output<typeof editPlanClaimSchema>
export type EditPlanBeat = z.output<typeof editPlanBeatSchema>
export type EditPlanNarration = z.output<typeof editPlanNarrationSchema>

export interface CompiledNarrationJob extends EditPlanNarration {
  beatId: string
  cacheKey: string
}

export interface EditPlanManifest {
  schemaVersion: 1
  planId: string
  title: string
  durationMs: number
  fps: number
  canvas: EditPlan['canvas']
  beats: Array<Pick<EditPlanBeat, 'id' | 'startMs' | 'endMs' | 'keyMessage' | 'claimIds'>>
  narration: Array<{ beatId: string; cacheKey: string }>
}

export interface CompiledEditPlan {
  plan: EditPlan
  durationMs: number
  captionsSrt: string
  narration: CompiledNarrationJob[]
  manifest: EditPlanManifest
}

export function parseEditPlan(input: unknown): EditPlan {
  return editPlanSchema.parse(input)
}

export function compileEditPlan(input: unknown): CompiledEditPlan {
  const plan = parseEditPlan(input)
  const durationMs = plan.beats[plan.beats.length - 1].endMs
  const narration = plan.beats.flatMap((beat) => beat.narration
    ? [{
        beatId: beat.id,
        ...beat.narration,
        cacheKey: narrationCacheKey(beat.narration),
      }]
    : [])
  const captionCues = plan.beats.flatMap((beat) => {
    const text = beat.caption ?? beat.narration?.text
    return text ? [{ startMs: beat.startMs, endMs: beat.endMs, text }] : []
  })

  return {
    plan,
    durationMs,
    captionsSrt: renderSrt(captionCues),
    narration,
    manifest: {
      schemaVersion: 1,
      planId: plan.id,
      title: plan.title,
      durationMs,
      fps: plan.fps,
      canvas: { ...plan.canvas },
      beats: plan.beats.map(({ id, startMs, endMs, keyMessage, claimIds }) => ({
        id,
        startMs,
        endMs,
        keyMessage,
        claimIds: [...claimIds],
      })),
      narration: narration.map(({ beatId, cacheKey }) => ({ beatId, cacheKey })),
    },
  }
}

export function narrationCacheKey(narration: Pick<EditPlanNarration, 'text' | 'voice' | 'rate' | 'engine'>): string {
  const content = JSON.stringify({
    engine: narration.engine,
    rate: narration.rate,
    text: narration.text,
    voice: narration.voice,
  })
  return createHash('sha256').update(content).digest('hex')
}

function renderSrt(cues: Array<{ startMs: number; endMs: number; text: string }>): string {
  if (cues.length === 0) return ''
  return `${cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}`,
    cue.text,
  ].join('\n')).join('\n\n')}\n`
}

function formatSrtTime(totalMs: number): string {
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const milliseconds = totalMs % 1000
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}
