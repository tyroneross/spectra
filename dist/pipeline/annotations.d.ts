import type { SfxCue } from './polish.js';
import type { DemoScript } from './script.js';
import { type CaptionBannerStyle, type CaptionBannerStyleName } from './text-render.js';
export interface TimedStepCard {
    stepLabel?: string;
    stepText: string;
    startMs: number;
    endMs: number;
}
export interface TimedStepCardsFilterOptions {
    inputLabel?: string;
    outputLabel?: string;
    cards: TimedStepCard[];
    outW?: number;
    outH?: number;
    fps?: number;
    x?: number;
    y?: number;
    fadeMs?: number;
    fontPixel?: number;
    fontSize?: number;
    cacheDir?: string;
    inputIndexStart?: number;
    /** Caption banner style preset (Pillow PNG path only; the ffmpeg bitmap fallback always uses CAPTION_BANNER_SPEC). */
    style?: CaptionBannerStyle | CaptionBannerStyleName;
}
export interface TimedStepCardsFilterPlan {
    filter: string;
    imagePaths: string[];
    usedPng: boolean;
    nextInputIndex: number;
}
export declare function cardsFromScript(script: DemoScript): TimedStepCard[];
export declare function soundCuesFromScript(script: DemoScript): SfxCue[];
export declare function timedStepCardsFilter(opts: TimedStepCardsFilterOptions): string;
export declare function timedStepCardsOverlayPlan(opts: TimedStepCardsFilterOptions): Promise<TimedStepCardsFilterPlan>;
export declare function timedStepCardsPngFilter(opts: TimedStepCardsFilterOptions): Promise<TimedStepCardsFilterPlan | undefined>;
export declare function normalizeStepLabel(label: string | undefined): string | undefined;
//# sourceMappingURL=annotations.d.ts.map