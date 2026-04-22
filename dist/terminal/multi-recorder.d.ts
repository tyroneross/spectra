import type { RecordResult } from './recorder.js';
export interface MultiRecordOptions {
    command: string;
    captureTerminal?: boolean;
    captureFiles?: {
        watch: string[];
    };
    outputDir?: string;
    maxDuration?: number;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    cwd?: string;
}
export interface FileChange {
    path: string;
    type: 'added' | 'modified' | 'deleted';
    timestamp: number;
}
export interface TimelineEvent {
    time: number;
    source: 'terminal' | 'file';
    event: string;
}
export interface MultiRecordResult {
    terminal?: RecordResult;
    fileChanges: FileChange[];
    timeline: TimelineEvent[];
    duration: number;
}
export declare function multiRecord(options: MultiRecordOptions): Promise<MultiRecordResult>;
//# sourceMappingURL=multi-recorder.d.ts.map