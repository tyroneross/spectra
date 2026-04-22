import type { Session, Action, Snapshot, DriverTarget, Platform } from './types.js';
export interface CreateSessionOptions {
    name?: string;
    platform: Platform;
    target: DriverTarget;
}
export interface AddStepOptions {
    action: Action;
    snapshotBefore: Snapshot;
    snapshotAfter: Snapshot;
    screenshot: Buffer;
    success: boolean;
    error?: string;
    duration: number;
    intent?: string;
}
export declare class SessionManager {
    private sessions;
    private basePath;
    constructor(cwd?: string);
    create(options: CreateSessionOptions): Promise<Session>;
    addStep(sessionId: string, options: AddStepOptions): Promise<void>;
    get(sessionId: string): Session | null;
    list(): Session[];
    close(sessionId: string): Promise<void>;
    closeAll(): Promise<void>;
    private sessionDir;
    private persist;
    private generateName;
}
//# sourceMappingURL=session.d.ts.map