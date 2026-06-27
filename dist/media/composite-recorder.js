// src/media/composite-recorder.ts
//
// MCP-driveable bridge to the window-isolated composite recorder
// (~/.spectra/bin/spectra-composite-capture, source native/swift/composite-capture/).
//
// Why this exists: the standalone binary captures specific WINDOWS via
// ScreenCaptureKit and is the only path that does not go black when the display
// sleeps — but historically only codex could drive it. This module lets Claude
// invoke it through the `spectra_demo action=record-composite` MCP tool.
//
// Two hardening measures over a bare binary spawn:
//   1. caffeinate wrap (-d display, -i idle, -s system) so the display never
//      sleeps mid-capture — the documented black-frame fix.
//   2. A post-capture black-frame guard: probe mean luminance with ffmpeg
//      signalstats and surface a warning when the output is all-black, so a
//      failed capture is detected instead of silently shipped.
//
// The pure helpers (buildCompositeArgs, buildCaffeinatedCommand, parseLuminance)
// are exported separately so the param→flag mapping is unit-testable without a
// GUI session or ffmpeg present.
import { spawn, spawnSync } from 'node:child_process';
import { ensureCompositeBinary } from '../native/compiler.js';
import { detectFfmpeg } from './ffmpeg.js';
export const COMPOSITE_DEFAULTS = {
    durationSeconds: 5,
    fps: 60,
    spotlight: 'none',
    cursor: true,
    maxWidth: 1600,
    crf: 20,
    /** Mean luminance (0..255) below which the output is treated as all-black. */
    blackThreshold: 16,
};
/**
 * Pure param→flag mapping for spectra-composite-capture. No I/O — unit-testable
 * without a GUI session. Throws on missing required fields.
 */
export function buildCompositeArgs(p) {
    if (!p.appA)
        throw new Error('composite record requires appA');
    if (!p.appB)
        throw new Error('composite record requires appB');
    if (!p.outPath)
        throw new Error('composite record requires outPath');
    const args = ['--app-a', p.appA, '--app-b', p.appB, '--out', p.outPath];
    if (p.titleA)
        args.push('--title-a', p.titleA);
    if (p.labelA)
        args.push('--label-a', p.labelA);
    if (p.titleB)
        args.push('--title-b', p.titleB);
    if (p.labelB)
        args.push('--label-b', p.labelB);
    args.push('--duration', String(p.durationSeconds ?? COMPOSITE_DEFAULTS.durationSeconds));
    args.push('--fps', String(p.fps ?? COMPOSITE_DEFAULTS.fps));
    args.push('--spotlight', p.spotlight ?? COMPOSITE_DEFAULTS.spotlight);
    // The binary defaults cursor on; emit the explicit flag either way so the
    // intent is visible in the recorded command line.
    args.push(p.cursor === false ? '--no-cursor' : '--cursor');
    args.push('--max-width', String(p.maxWidth ?? COMPOSITE_DEFAULTS.maxWidth));
    args.push('--crf', String(p.crf ?? COMPOSITE_DEFAULTS.crf));
    return args;
}
/**
 * Pure: wrap the recorder invocation in caffeinate so the display does not sleep
 * during capture. `-d` blocks display sleep (the black-frame fix), `-i` blocks
 * idle system sleep, `-s` blocks system sleep on AC. caffeinate runs the given
 * utility and exits when it exits.
 */
export function buildCaffeinatedCommand(binaryPath, binaryArgs) {
    return { command: 'caffeinate', args: ['-dis', binaryPath, ...binaryArgs] };
}
/**
 * Pure: parse ffmpeg `signalstats` YAVG (mean luminance) lines and decide whether
 * the sampled output is all-black. Accepts the combined ffmpeg stdout+stderr.
 */
export function parseLuminance(output, opts) {
    const threshold = opts?.blackThreshold ?? COMPOSITE_DEFAULTS.blackThreshold;
    const vals = [];
    const re = /lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(output)) !== null) {
        const v = parseFloat(m[1]);
        if (Number.isFinite(v))
            vals.push(v);
    }
    if (vals.length === 0) {
        return { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true };
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { sampleCount: vals.length, meanLuma: mean, allBlack: mean < threshold, skipped: false };
}
/**
 * Probe mean luminance of the finished capture. Samples 2 frames/sec through the
 * signalstats filter and prints per-frame metadata. Gracefully degrades to a
 * skipped guard if ffmpeg is unavailable or the probe errors.
 */
function probeBlackFrames(outPath, blackThreshold) {
    const ffmpeg = detectFfmpeg();
    if (!ffmpeg) {
        return { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true };
    }
    try {
        const r = spawnSync(ffmpeg, [
            '-nostats',
            '-i', outPath,
            '-vf', 'fps=2,signalstats,metadata=print:file=-',
            '-an',
            '-f', 'null',
            '-',
        ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        const combined = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
        return parseLuminance(combined, { blackThreshold });
    }
    catch {
        return { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true };
    }
}
/** Best-effort JSON parse of the binary's CompositeResult stdout. */
function parseBinaryStdout(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed)
        return {};
    try {
        const obj = JSON.parse(trimmed);
        return {
            output: typeof obj.output === 'string' ? obj.output : undefined,
            validation: obj.validation,
            details: obj,
        };
    }
    catch {
        return {};
    }
}
/**
 * Drive the window-isolated composite recorder end to end:
 *   ensure the binary is built → caffeinate-wrapped spawn → parse the result →
 *   black-frame guard. Throws only on a hard spawn/exit failure; an all-black
 *   output is reported via warnings, not thrown, so the caller can decide.
 */
export async function recordComposite(params) {
    const binaryArgs = buildCompositeArgs(params);
    const binary = ensureCompositeBinary();
    const { command, args } = buildCaffeinatedCommand(binary, binaryArgs);
    const commandLine = [command, ...args].join(' ');
    const { stdout, stderr, code } = await new Promise((resolve, reject) => {
        const proc = spawn(command, args, { stdio: 'pipe' });
        const outChunks = [];
        const errChunks = [];
        proc.stdout?.on('data', (c) => outChunks.push(Buffer.from(c)));
        proc.stderr?.on('data', (c) => errChunks.push(Buffer.from(c)));
        proc.on('error', reject);
        proc.on('close', (exitCode) => resolve({
            stdout: Buffer.concat(outChunks).toString('utf8'),
            stderr: Buffer.concat(errChunks).toString('utf8'),
            code: exitCode,
        }));
    });
    if (code !== 0) {
        return {
            ok: false,
            command: commandLine,
            blackFrameGuard: { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true },
            warnings: [],
            error: `spectra-composite-capture exited with code ${code}${stderr ? `\n${stderr.trim()}` : ''}`,
        };
    }
    const parsed = parseBinaryStdout(stdout);
    const outputPath = parsed.output ?? params.outPath;
    const blackThreshold = COMPOSITE_DEFAULTS.blackThreshold;
    const guard = probeBlackFrames(outputPath, blackThreshold);
    const warnings = [];
    if (guard.allBlack) {
        warnings.push(`Output appears all-black (mean luminance ${guard.meanLuma?.toFixed(1)} < ${blackThreshold} across ${guard.sampleCount} sampled frames). `
            + 'The capture likely failed — check that the target windows were visible and on-screen, '
            + 'screen-recording permission is granted, and the display was awake (caffeinate is applied automatically).');
    }
    else if (guard.skipped) {
        warnings.push('Black-frame guard skipped (ffmpeg unavailable or no frames sampled) — output luminance was not verified.');
    }
    return {
        ok: true,
        output: outputPath,
        command: commandLine,
        validation: parsed.validation,
        details: parsed.details,
        blackFrameGuard: guard,
        warnings,
    };
}
//# sourceMappingURL=composite-recorder.js.map