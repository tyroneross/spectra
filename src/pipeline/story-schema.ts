import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { compileEditPlan, editPlanClaimSchema } from '../media/edit-plan.js'

export const localPathSchema = z.string().min(1).refine(isAbsolute, 'Use an absolute local path')
export const polishStyleSchema = z.enum(['cool', 'warm', 'bold'])
export const autoFocusSchema = z.union([z.boolean(), z.object({ app: z.string().optional(), title: z.string().optional() })])
export const storySpotlightSchema = z.object({
  focal: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  dim: z.number().min(0).max(1).optional(), blur: z.number().nonnegative().optional(), feather: z.number().nonnegative().optional(),
})
const captureBeatSchema = z.object({
  id: z.string().min(1), startMs: z.number().nonnegative(), endMs: z.number().positive(),
  stepLabel: z.string().optional(), stepText: z.string().optional(),
  zoom: z.object({ cx: z.number(), cy: z.number(), scale: z.number().positive() }).optional(),
}).strict()
const capturePolishSchema = z.object({
  // No title: an implicit title-card intro would move this scene's clock.
  script: z.object({ beats: z.array(captureBeatSchema).min(1), finalCaption: z.string().optional() }).strict(),
  style: polishStyleSchema.optional(), spotlight: storySpotlightSchema.optional(),
}).strict()
const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('capture'), input: localPathSchema, startMs: z.number().nonnegative().default(0),
    evidence: z.string().min(1), keepAudio: z.boolean().default(false), polish: capturePolishSchema.optional() }).strict(),
  z.object({ kind: z.literal('media'), input: localPathSchema, startMs: z.number().nonnegative().default(0),
    producer: z.string().min(1), sourcePath: localPathSchema.optional(), keepAudio: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal('html'), entry: localPathSchema, seed: z.number().int().default(0), props: z.record(z.unknown()).default({}) }).strict(),
])
export const storySchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i), title: z.string().min(1),
  fps: z.number().int().min(1).max(60).default(30),
  canvas: z.object({ width: z.number().int().min(64).max(4096).multipleOf(2), height: z.number().int().min(64).max(4096).multipleOf(2) }),
  claims: z.array(editPlanClaimSchema).default([]),
  scenes: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i), keyMessage: z.string().min(1),
    durationMs: z.number().int().min(100).max(600_000), caption: z.string().optional(),
    claimIds: z.array(z.string().min(1)).default([]), source: sourceSchema,
  }).strict()).min(1).max(128),
  narration: z.array(z.object({ sceneId: z.string(), offsetMs: z.number().int().nonnegative().default(0),
    file: localPathSchema, text: z.string().min(1) }).strict()).max(256).default([]),
  music: localPathSchema.optional(),
  sfx: z.array(z.object({ atMs: z.number().int().nonnegative(), file: localPathSchema }).strict()).max(256).default([]),
}).strict().superRefine((story, ctx) => {
  try {
    const timeline = storyTimeline(story)
    if (timeline.at(-1)!.endMs > 1_800_000) throw new Error('Stories must be at most 30 minutes')
    compileEditPlan({ ...story, beats: timeline.map(s => ({ ...s, claimIds: s.claimIds })) })
    for (const scene of story.scenes) {
      for (const id of scene.claimIds) {
        if (!story.claims.find(c => c.id === id)?.evidence.length) throw new Error(`Used claim needs evidence: ${id}`)
      }
      if (scene.source.kind === 'capture' && scene.source.polish) {
        for (const beat of scene.source.polish.script.beats) {
          if (beat.endMs <= beat.startMs || beat.endMs > scene.durationMs) throw new Error(`Capture polish beat exceeds scene: ${scene.id}`)
        }
      }
    }
    for (const n of story.narration) if (!story.scenes.some(s => s.id === n.sceneId)) throw new Error(`Unknown narration scene: ${n.sceneId}`)
    for (const cue of story.sfx) if (cue.atMs >= timeline.at(-1)!.endMs) throw new Error('SFX starts beyond the story')
  } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message }) }
})
export type Story = z.output<typeof storySchema>
export type StoryInput = z.input<typeof storySchema>
export type StoryScene = Story['scenes'][number]

/** Quantize once; every consumer uses these frame boundaries. */
export function storyTimeline<S extends { id: string; keyMessage: string; durationMs: number; claimIds: string[]; caption?: string }>(story: { fps: number; scenes: S[] }) {
  let frame = 0
  return story.scenes.map(scene => {
    const startFrame = frame
    const frames = Math.max(1, Math.round(scene.durationMs * story.fps / 1000))
    frame += frames
    return { ...scene, startFrame, frames, startMs: Math.round(startFrame * 1000 / story.fps), endMs: Math.round(frame * 1000 / story.fps) }
  })
}
export const composeParamsSchema = z.object({ action: z.literal('compose'), storyPath: localPathSchema, outDir: localPathSchema }).strict()
export const composeStatusParamsSchema = z.object({ action: z.literal('compose-status'), outDir: localPathSchema }).strict()
