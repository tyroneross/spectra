/** Reviews are sampled from the encoded master, not the HTML source. */
export declare function storyReviews(input: string, outDir: string, temp: string, fps: number, timeline: Array<{
    startFrame: number;
    frames: number;
}>, signal?: AbortSignal): Promise<{
    contactSheet: string;
    strips: string[];
    poster: string;
}>;
//# sourceMappingURL=story-review.d.ts.map