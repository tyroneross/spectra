// src/media/ffmpeg.ts
import { execSync, spawn } from 'node:child_process';
let cachedFfmpegPath = undefined;
export function detectFfmpeg() {
    if (cachedFfmpegPath !== undefined)
        return cachedFfmpegPath;
    try {
        const path = execSync('which ffmpeg', { stdio: 'pipe' }).toString().trim();
        cachedFfmpegPath = path || null;
    }
    catch {
        cachedFfmpegPath = null;
    }
    return cachedFfmpegPath;
}
export function requireFfmpeg() {
    const path = detectFfmpeg();
    if (!path) {
        throw new Error('ffmpeg not found. Video recording requires ffmpeg.\n'
            + 'Install: brew install ffmpeg');
    }
    return path;
}
export async function transcode(input, output, options) {
    const ffmpeg = requireFfmpeg();
    const crf = options?.crf ?? 23;
    return new Promise((resolve, reject) => {
        const proc = spawn(ffmpeg, [
            '-i', input,
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-crf', String(crf),
            '-y', // overwrite
            output,
        ], { stdio: 'pipe' });
        const stderrChunks = [];
        proc.stderr?.on('data', (chunk) => stderrChunks.push(chunk));
        proc.on('close', (code) => {
            if (code === 0)
                resolve();
            else {
                const stderr = Buffer.concat(stderrChunks).toString().trim();
                reject(new Error(`ffmpeg exited with code ${code}${stderr ? '\n' + stderr : ''}`));
            }
        });
        proc.on('error', (err) => reject(err));
    });
}
//# sourceMappingURL=ffmpeg.js.map