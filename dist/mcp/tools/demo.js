// src/mcp/tools/demo.ts
// MCP tool handler for spectra_demo — polished agent demo video production.
import { z } from 'zod';
import { scanActivity, polishDemo } from '../../media/spotlight.js';
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
]);
// ─── Handler ──────────────────────────────────────────────────
export async function handleDemo(params) {
    const parsed = DemoSchema.parse(params);
    if (parsed.action === 'scan') {
        return scanActivity(parsed.input, { threshold: parsed.threshold });
    }
    // action === 'polish'
    return polishDemo(parsed.spec, parsed.out);
}
//# sourceMappingURL=demo.js.map