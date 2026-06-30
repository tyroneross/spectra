export interface TextRendererAvailability {
    available: boolean;
    reason?: string;
}
export interface StepCardPngOptions {
    stepText: string;
    stepLabel?: string;
    outW?: number;
    outH?: number;
    x?: number;
    y?: number;
    fontSize?: number;
    cacheDir?: string;
}
export interface CaptionPngOptions {
    text: string;
    outW?: number;
    outH?: number;
    fontSize?: number;
    cacheDir?: string;
}
export interface FrameChromePngOptions {
    outW: number;
    outH: number;
    contentW: number;
    contentH: number;
    contentX: number;
    contentY: number;
    cornerRadius: number;
    cacheDir?: string;
}
export interface FrameChromePngResult {
    backgroundPath: string;
    maskPath: string;
}
/**
 * Canonical caption banner / step-chip / caption-text spec, measured from the
 * reference clip demo-candidates/polished/rally__personas-two-agents__MERGED_CAPTIONED.mp4
 * (1600x900). Ratios are canonical; pixel values scale with outW/outH.
 * Shared by text-render.ts (Pillow), framing.ts, and annotations.ts (ffmpeg) so
 * all three renderers agree on one look.
 */
export declare const CAPTION_BANNER_SPEC: {
    /** Banner height as a fraction of frame height. */
    readonly bannerHeightRatio: 0.12;
    /** Banner background color, #050709. */
    readonly bannerBackground: {
        readonly r: 5;
        readonly g: 7;
        readonly b: 9;
    };
    /** Banner background opacity. */
    readonly bannerBackgroundAlpha: 0.92;
    /** Numbered chip side length as a fraction of frame height. */
    readonly chipSideRatio: 0.06;
    /** Chip corner radius as a fraction of the chip side. */
    readonly chipCornerRadiusRatio: 0.2;
    /** Chip fill color, #27AFE8. */
    readonly chipColor: {
        readonly r: 39;
        readonly g: 175;
        readonly b: 232;
    };
    /** Chip inset from the left edge as a fraction of frame width. */
    readonly chipInsetXRatio: 0.0325;
    /** Caption text color, #F8FAFC. */
    readonly captionTextColor: {
        readonly r: 248;
        readonly g: 250;
        readonly b: 252;
    };
    /** Gap between the chip's right edge and the caption text as a fraction of frame width. */
    readonly captionGapRatio: 0.015;
};
export declare function textRendererAvailability(): Promise<TextRendererAvailability>;
export declare function setTextRendererAvailabilityForTests(availability: TextRendererAvailability | undefined): void;
export declare function renderStepCardPng(options: StepCardPngOptions): Promise<string | undefined>;
export declare function renderCaptionPng(options: CaptionPngOptions): Promise<string | undefined>;
export declare function renderFrameChromePng(options: FrameChromePngOptions): Promise<FrameChromePngResult | undefined>;
//# sourceMappingURL=text-render.d.ts.map