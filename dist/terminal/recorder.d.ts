export interface RecordOptions {
    command: string;
    args?: string[];
    shell?: boolean;
    cwd?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
    maxDuration?: number;
    outputPath?: string;
}
export interface RecordResult {
    castFile: string;
    exitCode: number;
    duration: number;
    outputSize: number;
    lines: number;
}
export declare function recordTerminal(options: RecordOptions): Promise<RecordResult>;
//# sourceMappingURL=recorder.d.ts.map