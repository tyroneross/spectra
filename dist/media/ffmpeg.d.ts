export declare function detectFfmpeg(): string | null;
export declare function requireFfmpeg(): string;
export declare function transcode(input: string, output: string, options?: {
    crf?: number;
}): Promise<void>;
//# sourceMappingURL=ffmpeg.d.ts.map