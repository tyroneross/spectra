import type { FocalRect } from '../media/spotlight.js';
import { type DemoScript } from './script.js';
import { type CursorPoint, type ZoomClick } from './zoom-keyframes.js';
export type ClicksJsonInput = string | ZoomClick[] | {
    clicks?: ZoomClick[];
    cursorPath?: CursorPoint[];
};
/**
 * Optional whole-clip spotlight pre-pass: the focal rect stays sharp and full
 * brightness, everything else gets a feathered blur + dark-crush toward
 * near-black (see pipeline/spotlight.ts DARK_SPOTLIGHT_DEFAULTS). Applied
 * before zoom/framing/caption so those stages see an already-spotlighted
 * frame. Per-beat spotlight is out of scope — this is a single focal rect for
 * the whole clip.
 */
export interface PolishClipSpotlightOptions {
    focal: FocalRect;
    dim?: number;
    blur?: number;
    feather?: number;
}
export interface PolishClipOptions {
    input: string;
    clicksJson: ClicksJsonInput;
    caption?: string;
    outPath: string;
    fps?: number;
    spotlight?: PolishClipSpotlightOptions;
}
export interface PolishScriptOptions {
    input: string;
    script: DemoScript;
    outPath: string;
    fps?: number;
}
export interface PolishClipResult {
    outPath: string;
    width: number;
    height: number;
    fps: number;
    durationMs: number;
    frames: number;
}
export declare function polishClip(options: PolishClipOptions): Promise<PolishClipResult>;
export declare function polishScript(options: PolishScriptOptions): Promise<PolishClipResult>;
export declare function finalCaptionWindow(script: DemoScript, finalCaption: string, durationMs: number): {
    startMs: number;
    endMs: number;
} | null;
interface AudioArgs {
    /** Spliced in right after `-map [v]`. */
    mapArgs: string[];
    /** Spliced in right after `-frames:v`, alongside the video codec args. */
    codecArgs: string[];
}
/**
 * Builds the audio map + codec ffmpeg args. When the input has an audio
 * stream, it's preserved (re-encoded to AAC, since the rest of the pipeline
 * only ever re-encodes video) and trimmed to the video's length via
 * `-shortest` so a longer source audio track doesn't trail past the
 * `-frames:v`-limited video output. When there's no audio, behavior is
 * unchanged from before (`-an`).
 */
export declare function buildAudioArgs(hasAudio: boolean): AudioArgs;
export {};
//# sourceMappingURL=polish.d.ts.map