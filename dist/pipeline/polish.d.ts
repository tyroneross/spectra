import type { FocalRect } from '../media/spotlight.js';
import { type DemoScript } from './script.js';
import { type CaptionBannerStyle, type CaptionBannerStyleName } from './text-render.js';
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
/**
 * Auto-detects the focal window instead of requiring a hand-specified
 * `spotlight.focal` rect -- for captures showing multiple windows / desktop
 * clutter, where the frontmost/target window should be spotlighted
 * automatically. `true` auto-detects the frontmost application's window; an
 * object filters by app name and/or window title substring (see
 * `resolveFocalRect` in window-focus.ts). Ignored when an explicit
 * `spotlight` is already given. If the underlying native helper can't
 * resolve a window (missing binary, no GUI session, no match), auto-focus is
 * silently skipped -- it never fails the render.
 */
export type AutoFocusOption = boolean | {
    app?: string;
    title?: string;
};
export interface PolishClipOptions {
    input: string;
    clicksJson: ClicksJsonInput;
    caption?: string;
    outPath: string;
    fps?: number;
    spotlight?: PolishClipSpotlightOptions;
    /** See `AutoFocusOption`. */
    autoFocus?: AutoFocusOption;
    /**
     * Caption banner style preset ('cool' | 'warm' | 'bold', or a custom
     * CaptionBannerStyle object). Threaded down into the step-card/caption PNG
     * renders. Absent => 'cool' (today's fixed look, unchanged). 'bold' also
     * turns on the dark-crush spotlight pre-pass by default -- see `spotlight`.
     */
    style?: CaptionBannerStyle | CaptionBannerStyleName;
}
export interface PolishScriptOptions {
    input: string;
    script: DemoScript;
    outPath: string;
    fps?: number;
    /**
     * Path to a voiceover/narration audio file. When set, this audio REPLACES
     * any input audio: it starts at t=0, is padded with silence if shorter than
     * the video (so a short VO never truncates the video) and trimmed to the
     * video duration if longer. When absent, behavior is unchanged (input audio
     * passthrough via buildAudioArgs, or `-an` when the source is silent).
     */
    voiceover?: string;
    /** Same whole-clip dark-crush spotlight pre-pass as PolishClipOptions.spotlight. */
    spotlight?: PolishClipSpotlightOptions;
    /** Same auto-focal-window detection as PolishClipOptions.autoFocus. */
    autoFocus?: AutoFocusOption;
    /** Same caption banner style preset as PolishClipOptions.style. */
    style?: CaptionBannerStyle | CaptionBannerStyleName;
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
 * only ever re-encodes video). The audio is first padded with silence via
 * `-af apad` so it's never SHORTER than the `-frames:v`-limited video output
 * — without this, a source audio track shorter than the video would let
 * `-shortest` cut the video early too, truncating the final captioned
 * payoff. `-shortest` then trims the (now-padded) audio at the video's end,
 * so video duration always wins regardless of which track was originally
 * longer. When there's no audio, behavior is unchanged from before (`-an`).
 * `delayMs` front-pads the audio with silence (adelay) — used when the intro
 * title card shifts the source content later, so audio stays in sync with it.
 */
export declare function buildAudioArgs(hasAudio: boolean, delayMs?: number): AudioArgs;
/**
 * Builds the audio map + codec ffmpeg args for a SEPARATE voiceover input
 * (mux a narration track instead of the source's own audio). The source's
 * audio is NOT mapped, so the voiceover fully REPLACES any input audio. The
 * voiceover maps from `${voiceoverInputIndex}:a`, starts at t=0, and is pinned
 * to exactly the video duration via `apad,atrim=end=<videoDurationSec>`:
 * `apad` pads with trailing silence so a VO SHORTER than the video never
 * truncates the video, and `atrim=end` cuts a VO LONGER than the video to the
 * video duration. This is done in the filter graph (deterministic) rather than
 * via `-shortest`, which does not reliably trim a frames-capped output on
 * short clips. `voiceoverInputIndex` is the 0-based ffmpeg `-i` index of the
 * voiceover input, which polishScript appends after the source/mask/overlay
 * inputs; `videoDurationSec` is the true output video duration (frames / fps).
 * `delayMs` front-pads the voiceover with silence (adelay) so narration stays
 * aligned with the demo content when the intro title card shifts it later.
 */
export declare function buildVoiceoverAudioArgs(voiceoverInputIndex: number, videoDurationSec: number, delayMs?: number): AudioArgs;
export {};
//# sourceMappingURL=polish.d.ts.map