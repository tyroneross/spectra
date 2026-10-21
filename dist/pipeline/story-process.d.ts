export declare function regularFile(path: string): Promise<string>;
export declare function runProcess(command: string, args: string[], signal?: AbortSignal, timeout?: number, onStdout?: (chunk: Buffer) => void): Promise<string>;
export declare function ffmpeg(args: string[], signal?: AbortSignal): Promise<string>;
export declare function probe(path: string, signal?: AbortSignal): Promise<{
    duration: number;
    videoDuration: number;
    width: number;
    height: number;
    audio: boolean;
}>;
//# sourceMappingURL=story-process.d.ts.map