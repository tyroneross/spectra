export interface RecordParams {
    command: string;
    timeout?: number;
    watch_files?: string[];
    outputDir?: string;
}
export interface RecordToolResult {
    castFile?: string;
    exitCode?: number;
    duration: number;
    outputSize?: number;
    lines?: number;
    fileChanges: number;
    timeline: Array<{
        time: number;
        source: string;
        event: string;
    }>;
}
export declare function handleRecord(params: RecordParams): Promise<RecordToolResult>;
export interface ReplayParams {
    file: string;
    search?: string;
    commands_only?: boolean;
}
export interface ReplayToolResult {
    summary: string;
    events?: Array<{
        time: number;
        type: string;
        data: string;
    }>;
    commands?: string[];
    matchCount?: number;
}
export declare function handleReplay(params: ReplayParams): Promise<ReplayToolResult>;
//# sourceMappingURL=record.d.ts.map