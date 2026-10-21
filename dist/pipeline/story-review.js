import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ffmpeg } from './story-process.js';
/** Reviews are sampled from the encoded master, not the HTML source. */
export async function storyReviews(input, outDir, temp, fps, timeline, signal) {
    const reviews = join(outDir, 'reviews');
    await mkdir(reviews);
    async function sheet(frames, name, columns) {
        const dir = join(temp, name);
        await mkdir(dir);
        for (const [i, frame] of frames.entries()) {
            await ffmpeg(['-ss', String(frame / fps), '-i', input, '-frames:v', '1', '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2', join(dir, `${String(i).padStart(4, '0')}.png`)], signal);
        }
        const out = join(reviews, `${name}.png`);
        await ffmpeg(['-framerate', '1', '-i', join(dir, '%04d.png'), '-vf', `tile=${columns}x${Math.ceil(frames.length / columns)}`, '-frames:v', '1', out], signal);
        return out;
    }
    const contactSheet = await sheet(timeline.map(s => s.startFrame + Math.floor(s.frames / 2)), 'contact-sheet', Math.min(4, timeline.length));
    const total = timeline.at(-1).startFrame + timeline.at(-1).frames;
    const strips = [];
    for (const [i, scene] of timeline.slice(1).entries()) {
        strips.push(await sheet([-3, -2, -1, 0, 1, 2].map(d => Math.max(0, Math.min(total - 1, scene.startFrame + d))), `cut-${i + 1}`, 3));
    }
    const poster = join(outDir, 'poster.png');
    await ffmpeg(['-ss', String((timeline[0].startFrame + Math.floor(timeline[0].frames / 2)) / fps), '-i', input, '-frames:v', '1', poster], signal);
    return { contactSheet, strips, poster };
}
//# sourceMappingURL=story-review.js.map