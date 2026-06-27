import { type ChildProcess } from 'node:child_process';
export interface KeepAwakeController {
    recordingStarted(recordingId: string): Promise<void>;
    recordingStopped(recordingId: string): Promise<void>;
    close(): Promise<void>;
    readonly activeRecordings: number;
    readonly engaged: boolean;
}
export declare class NoopKeepAwakeController implements KeepAwakeController {
    private readonly recordings;
    get activeRecordings(): number;
    get engaged(): boolean;
    recordingStarted(recordingId: string): Promise<void>;
    recordingStopped(recordingId: string): Promise<void>;
    close(): Promise<void>;
}
export type KeepAwakeSpawn = (command: string, args: string[]) => Pick<ChildProcess, 'pid' | 'kill' | 'once' | 'on'>;
export interface DaemonKeepAwakeControllerOptions {
    command?: string;
    args?: string[];
    platform?: NodeJS.Platform;
    spawn?: KeepAwakeSpawn;
}
export declare class DaemonKeepAwakeController implements KeepAwakeController {
    private readonly recordings;
    private readonly command;
    private readonly args;
    private readonly platform;
    private readonly spawnProcess;
    private proc;
    constructor(options?: DaemonKeepAwakeControllerOptions);
    get activeRecordings(): number;
    get engaged(): boolean;
    recordingStarted(recordingId: string): Promise<void>;
    recordingStopped(recordingId: string): Promise<void>;
    close(): Promise<void>;
    private ensureEngaged;
    private release;
}
export declare function createKeepAwakeController(): KeepAwakeController;
//# sourceMappingURL=keep-awake.d.ts.map