// src/mcp/tools/demo.ts
// MCP tool handler for spectra_demo — polished agent demo video production.
import { z } from 'zod'
import { scanActivity, polishDemo, autoRampDemo } from '../../media/spotlight.js'
import { polishClip, polishScript } from '../../pipeline/polish.js'
import type { ToolContext } from '../context.js'

// NOTE: action 'record-composite' is dispatched by the daemon (CoreApiImpl.demo →
// recordComposite → src/daemon/composite-worker.ts) and is intercepted before
// reaching this handler, so it intentionally has no branch here. The window-
// isolated recorder (caffeinate keep-awake + black-frame guard) is owned by the
// daemon worker; this handler covers the ffmpeg-only actions
// (scan/polish/auto-ramp/polish-clip/polish-script).
//
// polish-clip / polish-script reach the rich pipeline (src/pipeline/polish.ts —
// zoom + window-chrome + caption-banner renderer). `polish` above stays wired to
// the older, simpler media/spotlight.ts renderer for backward compatibility.

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

// ─── Rich polish pipeline schemas (mirrors pipeline/polish.ts + pipeline/script.ts) ─

const ZoomClickSchema = z.object({ tMs: z.number(), cx: z.number(), cy: z.number() })
const CursorPointSchema = z.object({ tMs: z.number(), cx: z.number(), cy: z.number() })
const ClicksJsonSchema = z.union([
  z.string().describe('Inline JSON or a path to a clicks JSON file'),
  z.array(ZoomClickSchema).describe('Inline click track'),
  z.object({
    clicks: z.array(ZoomClickSchema).optional(),
    cursorPath: z.array(CursorPointSchema).optional(),
  }).describe('Click track + optional cursor path'),
])

const DemoScriptBeatActionSchema = z.object({
  kind: z.enum(['search', 'click', 'scroll', 'navigate', 'hold']),
  target: z.string().optional(),
  value: z.string().optional(),
})
const DemoScriptBeatSchema = z.object({
  id: z.string(),
  stepLabel: z.string().optional(),
  stepText: z.string().optional(),
  startMs: z.number(),
  endMs: z.number(),
  zoom: z.object({ cx: z.number(), cy: z.number(), scale: z.number() }).optional(),
  action: DemoScriptBeatActionSchema.optional(),
})
const DemoScriptSchema = z.object({
  title: z.string().optional(),
  finalCaption: z.string().optional(),
  beats: z.array(DemoScriptBeatSchema),
}).describe('Multi-beat demo script — timed captions + zoom windows')

// Optional whole-clip dark-crush spotlight pre-pass for polish-clip (mirrors
// pipeline/spotlight.ts PolishClipSpotlightOptions). The focal rect stays
// sharp and full brightness; everything else gets a feathered blur + heavy
// darken toward near-black before zoom/framing/caption are applied.
const SpotlightSchema = z.object({
  focal: FocalRectSchema.describe('Focal region to keep sharp (x, y, w, h in source pixels)'),
  dim: z.number().optional().describe('Background darken amount, 0-1 (default 0.75 — heavy dark-crush)'),
  blur: z.number().optional().describe('Background gblur sigma (default 8)'),
  feather: z.number().optional().describe('Soft edge width between focal and periphery, px (default 26)'),
}).describe('Whole-clip spotlight: sharp focal pane, dark-crushed + blurred periphery')

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
    action: z.literal('polish-clip'),
    input: z.string().describe('Path to the source clip to polish'),
    clicksJson: ClicksJsonSchema.describe('Click/cursor track driving the zoom — inline JSON, a path, or {clicks, cursorPath}'),
    caption: z.string().optional().describe('Lower-third caption text rendered as a caption banner'),
    out: z.string().describe('Output mp4 path'),
    fps: z.number().optional().describe('Output fps (default 60)'),
    spotlight: SpotlightSchema.optional(),
  }),
  z.object({
    action: z.literal('polish-script'),
    input: z.string().describe('Path to the source recording'),
    script: DemoScriptSchema,
    out: z.string().describe('Output mp4 path'),
    fps: z.number().optional().describe('Output fps (default 60)'),
    voiceover: z.string().optional().describe('Path to a voiceover audio file — REPLACES input audio, synced to t=0 and padded/trimmed to the video duration'),
  }),
])

// ─── Handler ──────────────────────────────────────────────────

export async function handleDemo(params: unknown, _ctx?: ToolContext): Promise<object> {
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

  if (parsed.action === 'polish-clip') {
    return polishClip({
      input: parsed.input,
      clicksJson: parsed.clicksJson,
      caption: parsed.caption,
      outPath: parsed.out,
      fps: parsed.fps,
      spotlight: parsed.spotlight,
    })
  }

  if (parsed.action === 'polish-script') {
    return polishScript({
      input: parsed.input,
      script: parsed.script,
      outPath: parsed.out,
      fps: parsed.fps,
      voiceover: parsed.voiceover,
    })
  }

  // action === 'polish'
  return polishDemo(parsed.spec, parsed.out)
}
