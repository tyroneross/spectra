import type { Session, Step, Action, Snapshot, DriverTarget, Platform, CaptureRunArtifact, CaptureRunDecision, CaptureRunManifest, CaptureRunPlannerSource, CaptureRunRecording } from './types.js';
export interface CreateSessionOptions {
    name?: string;
    platform: Platform;
    target: DriverTarget;
    /**
     * Absolute path to the repo that this session was launched against, if any.
     * When present, the session's `storageRoot` is anchored under this repo
     * regardless of daemon CWD (fixes launchd-spawned daemons writing to $HOME).
     */
    repoPath?: string;
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
    tool?: string;
    plannerSource?: CaptureRunPlannerSource;
    decisionId?: string;
}
export type AddDecisionOptions = Omit<CaptureRunDecision, 'id' | 'timestamp'>;
export type AddArtifactOptions = Omit<CaptureRunArtifact, 'id' | 'createdAt'>;
export type RecordingStatusUpdate = Partial<CaptureRunRecording> & Pick<CaptureRunRecording, 'state'>;
export declare class SessionManager {
    private sessions;
    private runs;
    private basePath;
    constructor(cwd?: string);
    create(options: CreateSessionOptions): Promise<Session>;
    addStep(sessionId: string, options: AddStepOptions): Promise<Step>;
    addDecision(sessionId: string, options: AddDecisionOptions): Promise<CaptureRunDecision>;
    addArtifact(sessionId: string, options: AddArtifactOptions): Promise<CaptureRunArtifact>;
    setRecordingStatus(sessionId: string, update: RecordingStatusUpdate): Promise<CaptureRunRecording>;
    get(sessionId: string): Session | null;
    getRun(sessionId: string): CaptureRunManifest | null;
    list(): Session[];
    close(sessionId: string): Promise<void>;
    closeAll(): Promise<void>;
    /**
     * Returns the absolute path to the session directory. Prefers the per-session
     * `storageRoot` recorded at creation time (set when `repoPath` was supplied);
     * falls back to the manager-level `basePath` for legacy sessions.
     */
    sessionDir(sessionId: string): string;
    private persist;
    private persistRun;
    private createRunManifest;
    private updateRun;
    private ensureRun;
    private addRunAction;
    private generateName;
}
//# sourceMappingURL=session.d.ts.map