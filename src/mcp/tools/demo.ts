// src/mcp/tools/demo.ts
// MCP tool handler for spectra_demo — polished agent demo video production.
import { z } from 'zod'
import { scanActivity, polishDemo, autoRampDemo } from '../../media/spotlight.js'
import { recordComposite, type CompositeRecordParams } from '../../media/composite-recorder.js'
import type { ToolContext } from '../context.js'

// ─── Zod schema ───────────────────────────────────────────────

const FocalRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
})

const CanvasSizeSchema = z.object({
  w: z.number(),
  h: z.number(),
})

const SegmentSchema = z.object({
  input: z.string().describe('Path to the source recording'),
  startSec: z.number().describe('Start offset in seconds'),
  durationSec: z.number().describe('Segment duration in seconds'),
  focal: FocalRectSchema.describe('Focal region (x, y, w, h in source pixels)'),
  caption: z.string().optional().describe('Lower-third caption text (rendered with drawtext)'),
  captionPngPath: z.string().optional().describe('PNG overlay path used when drawtext is unavailable'),
})

const PolishSpecSchema = z.object({
  canvas: CanvasSizeSchema.describe('Output canvas dimensions'),
  fps: z.number().optional().describe('Normalize frame rate (informational — applied at render time)'),
  segments: z.array(SegmentSchema).describe('Ordered list of segments to render and merge'),
  speed: z.number().optional().describe('Playback speed multiplier applied to all segments (e.g. 1.5 = 50% faster)'),
})

export const DemoSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('scan'),
    input: z.string().describe('Path to the source video to scan'),
    threshold: z.number().optional().describe('Scene-change sensitivity (default: 0.04)'),
  }),
  z.object({
    action: z.literal('polish'),
    spec: PolishSpecSchema,
    out: z.string().describe('Output mp4 path'),
  }),
  z.object({
    action: z.literal('auto-ramp'),
    input: z.string().describe('Source recording to speed-ramp'),
    out: z.string().describe('Output mp4 path'),
    deadSpeed: z.number().optional().describe('Speed multiplier for dead-air spans (default 1.8)'),
    minDeadSec: z.number().optional().describe('Min gap length to ramp, seconds (default 1.5)'),
    threshold: z.number().optional().describe('Scene-change sensitivity (default 0.04)'),
    maxWidth: z.number().optional().describe('Lanczos-downscale max width (default 1600)'),
    crf: z.number().optional().describe('x264 quality (default 20)'),
    fps: z.number().optional().describe('Output fps (default 60)'),
  }),
  z.object({
    action: z.literal('record-composite'),
    appA: z.string().describe('App name / bundle substring for the LEFT pane'),
    titleA: z.string().optional().describe('Optional window-title substring for the left pane'),
    labelA: z.string().optional().describe('Optional label for the left pane'),
    appB: z.string().describe('App name / bundle substring for the RIGHT pane'),
    titleB: z.string().optional().describe('Optional window-title substring for the right pane'),
    labelB: z.string().optional().describe('Optional label for the right pane'),
    durationSeconds: z.number().optional().describe('Capture duration in seconds (default 5)'),
    fps: z.number().optional().describe('Capture FPS (default 60)'),
    spotlight: z.enum(['none', 'a', 'b']).optional().describe('Dim+blur the non-focal pane: none | a (left) | b (right). Default none'),
    cursor: z.boolean().optional().describe('Composite a smoothed cursor sprite (default true)'),
    maxWidth: z.number().optional().describe('Lanczos-downscale final width to <= px (default 1600)'),
    crf: z.number().optional().describe('x264 quality 1..51, lower=better (default 20)'),
    outPath: z.string().describe('Composite MP4 output path'),
    sessionId: z.string().optional().describe('Optional session to register the artifact against'),
  }),
])

// ─── Handler ──────────────────────────────────────────────────

export async function handleDemo(params: unknown, ctx?: ToolContext): Promise<object> {
  const parsed = DemoSchema.parse(params)

  if (parsed.action === 'scan') {
    return scanActivity(parsed.input, { threshold: parsed.threshold })
  }

  if (parsed.action === 'auto-ramp') {
    return autoRampDemo(parsed.input, parsed.out, {
      deadSpeed: parsed.deadSpeed,
      minDeadSec: parsed.minDeadSec,
      threshold: parsed.threshold,
      maxWidth: parsed.maxWidth,
      crf: parsed.crf,
      fps: parsed.fps,
    })
  }

  if (parsed.action === 'record-composite') {
    const recordParams: CompositeRecordParams = {
      appA: parsed.appA,
      titleA: parsed.titleA,
      labelA: parsed.labelA,
      appB: parsed.appB,
      titleB: parsed.titleB,
      labelB: parsed.labelB,
      durationSeconds: parsed.durationSeconds,
      fps: parsed.fps,
      spotlight: parsed.spotlight,
      cursor: parsed.cursor,
      maxWidth: parsed.maxWidth,
      crf: parsed.crf,
      outPath: parsed.outPath,
    }
    const result = await recordComposite(recordParams)

    // Best-effort session artifact entry — only when a sessionId is supplied and
    // the recording succeeded. A missing run must not fail the capture.
    let artifactId: string | undefined
    if (result.ok && result.output && parsed.sessionId && ctx) {
      try {
        const artifact = await ctx.sessions.addArtifact(parsed.sessionId, {
          type: 'video',
          path: result.output,
          format: 'mp4',
          metadata: {
            source: 'spectra-composite-capture',
            command: result.command,
            spotlight: parsed.spotlight ?? 'none',
            fps: parsed.fps ?? 60,
            blackFrameGuard: result.blackFrameGuard,
          },
        })
        artifactId = artifact.id
      } catch {
        // Session has no active run / not found — surface as a warning, not a failure.
        result.warnings.push(
          `Could not register artifact against session ${parsed.sessionId} (no active run).`,
        )
      }
    }

    return { ...result, artifactId }
  }

  // action === 'polish'
  return polishDemo(parsed.spec, parsed.out)
}
