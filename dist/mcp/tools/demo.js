// src/mcp/tools/demo.ts
// MCP tool handler for spectra_demo — polished agent demo video production.
import { z } from 'zod';
import { scanActivity, polishDemo, autoRampDemo } from '../../media/spotlight.js';
// NOTE: action 'record-composite' is dispatched by the daemon (CoreApiImpl.demo →
// recordComposite → src/daemon/composite-worker.ts) and is intercepted before
// reaching this handler, so it intentionally has no branch here. The window-
// isolated recorder (caffeinate keep-awake + black-frame guard) is owned by the
// daemon worker; this handler covers the ffmpeg-only actions (scan/polish/auto-ramp).
// ─── Zod schema ───────────────────────────────────────────────
const FocalRectSchema = z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
});
const CanvasSizeSchema = z.object({
    w: z.number(),
    h: z.number(),
});
const SegmentSchema = z.object({
    input: z.string().describe('Path to the source recording'),
    startSec: z.number().describe('Start offset in seconds'),
    durationSec: z.number().describe('Segment duration in seconds'),
    focal: FocalRectSchema.describe('Focal region (x, y, w, h in source pixels)'),
    caption: z.string().optional().describe('Lower-third caption text (rendered with drawtext)'),
    captionPngPath: z.string().optional().describe('PNG overlay path used when drawtext is unavailable'),
});
const PolishSpecSchema = z.object({
    canvas: CanvasSizeSchema.describe('Output canvas dimensions'),
    fps: z.number().optional().describe('Normalize frame rate (informational — applied at render time)'),
    segments: z.array(SegmentSchema).describe('Ordered list of segments to render and merge'),
    speed: z.number().optional().describe('Playback speed multiplier applied to all segments (e.g. 1.5 = 50% faster)'),
});
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
]);
// ─── Handler ──────────────────────────────────────────────────
export async function handleDemo(params, _ctx) {
    const parsed = DemoSchema.parse(params);
    if (parsed.action === 'scan') {
        return scanActivity(parsed.input, { threshold: parsed.threshold });
    }
    if (parsed.action === 'auto-ramp') {
        return autoRampDemo(parsed.input, parsed.out, {
            deadSpeed: parsed.deadSpeed,
            minDeadSec: parsed.minDeadSec,
            threshold: parsed.threshold,
            maxWidth: parsed.maxWidth,
            crf: parsed.crf,
            fps: parsed.fps,
        });
    }
    // action === 'polish'
    return polishDemo(parsed.spec, parsed.out);
}
//# sourceMappingURL=demo.js.map