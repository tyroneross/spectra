/** Trusted authored HTML only. No wall-clock playback, remote assets or user profile. */
export declare function renderHtmlFrames(options: {
    entry: string;
    width: number;
    height: number;
    fps: number;
    frames: number;
    seed: number;
    frameDir: string;
    signal?: AbortSignal;
    sampleFrames?: number[];
    props?: Record<string, unknown>;
}): Promise<string[]>;
//# sourceMappingURL=html-render.d.ts.map