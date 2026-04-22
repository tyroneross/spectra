// src/media/pipeline.ts
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
function defaultRunner(cmd, args) {
    const proc = spawn(cmd, args, { stdio: 'pipe' });
    return {
        kill: () => proc.kill(),
        waitForExit: () => new Promise((resolve, reject) => {
            proc.on('close', (code) => resolve(code ?? 0));
            proc.on('error', reject);
        }),
    };
}
let runner = defaultRunner;
export function setProcessRunner(r) {
    runner = r;
}
export function resetProcessRunner() {
    runner = defaultRunner;
}
// ─── Argument Builders ───────────────────────────────────────
const DEFAULT_OPTIONS = {
    fps: 30,
    quality: 'high',
    hardware: true,
    maxDuration: 300,
};
/**
 * Build FFmpeg (or xcrun simctl) arguments for the capture phase.
 * Returns args without the leading command name.
 */
export function buildCaptureArgs(platform, outputPath, options) {
    if (platform === 'ios' || platform === 'watchos') {
        // simctl path — not ffmpeg
        return [
            'simctl', 'io', 'booted', 'recordVideo',
            '--codec', 'h264',
            '--force',
            outputPath,
        ];
    }
    // web / macos → avfoundation screen capture
    return [
        '-f', 'avfoundation',
        '-framerate', String(options.fps),
        '-i', '1:none',
        '-c:v', 'libx264rgb',
        '-crf', '0',
        '-preset', 'ultrafast',
        outputPath,
    ];
}
/**
 * Build FFmpeg arguments for the encode/distribution phase.
 * Returns args without the leading 'ffmpeg'.
 */
export function buildEncodeArgs(inputPath, outputPath, options) {
    const useHardware = options.hardware && options.quality !== 'lossless';
    if (useHardware) {
        const bitrate = options.quality === 'high' ? '5M' : '2M';
        return [
            '-i', inputPath,
            '-c:v', 'h264_videotoolbox',
            '-b:v', bitrate,
            '-pix_fmt', 'yuv420p',
            outputPath,
        ];
    }
    // Software encoding with libx264
    const crfMap = {
        lossless: 0,
        high: 20,
        medium: 28,
    };
    const crf = crfMap[options.quality];
    return [
        '-i', inputPath,
        '-c:v', 'libx264',
        '-crf', String(crf),
        '-preset', 'slow',
        '-pix_fmt', 'yuv420p',
        outputPath,
    ];
}
// ─── Recording ───────────────────────────────────────────────
/**
 * Start a recording session. Returns a RecordingHandle with stop().
 */
export async function startRecording(platform, outputDir, options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const timestamp = Date.now();
    const isSimctl = platform === 'ios' || platform === 'watchos';
    const ext = isSimctl ? 'mp4' : 'mkv';
    const outputPath = join(outputDir, `raw-${timestamp}.${ext}`);
    const captureArgs = buildCaptureArgs(platform, outputPath, opts);
    const cmd = isSimctl ? 'xcrun' : 'ffmpeg';
    const proc = runner(cmd, captureArgs);
    const maxDuration = opts.maxDuration ?? DEFAULT_OPTIONS.maxDuration;
    const timeoutId = setTimeout(() => {
        proc.kill();
    }, maxDuration * 1000);
    const handle = {
        platform,
        stop: async () => {
            clearTimeout(timeoutId);
            proc.kill();
            await proc.waitForExit().catch(() => { });
            return outputPath;
        },
    };
    return handle;
}
// ─── Encoding ────────────────────────────────────────────────
/**
 * Encode a raw recording for distribution. Returns VideoResult.
 */
export async function encodeRecording(rawPath, outputDir, options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const timestamp = Date.now();
    const outputPath = join(outputDir, `video-${timestamp}.mp4`);
    const encodeArgs = buildEncodeArgs(rawPath, outputPath, opts);
    const proc = runner('ffmpeg', encodeArgs);
    const exitCode = await proc.waitForExit();
    if (exitCode !== 0) {
        throw new Error(`ffmpeg encode failed with exit code ${exitCode}`);
    }
    const fileStat = await stat(outputPath);
    const useHardware = opts.hardware && opts.quality !== 'lossless';
    const codec = useHardware ? 'h264_videotoolbox' : 'libx264';
    return {
        path: outputPath,
        duration: 0, // duration requires ffprobe — set to 0 as placeholder
        size: fileStat.size,
        codec,
        fps: opts.fps,
    };
}
//# sourceMappingURL=pipeline.js.map