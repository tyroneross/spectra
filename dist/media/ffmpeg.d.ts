export declare const CRASH_SAFE_MP4_MOVFLAGS = "+frag_keyframe+empty_moov+default_base_moof";
/**
 * MP4 muxer arguments that keep completed one-second fragments playable when
 * ffmpeg exits without writing a conventional final moov atom.
 */
export declare function crashSafeMp4Args(options?: {
    forceKeyFrames?: boolean;
}): string[];
export declare function detectFfmpeg(): string | null;
export declare function requireFfmpeg(): string;
export declare function transcode(input: string, output: string, options?: {
    crf?: number;
}): Promise<void>;
//# sourceMappingURL=ffmpeg.d.ts.map