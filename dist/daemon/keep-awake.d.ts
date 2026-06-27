export interface KeepAwakeController {
    recordingStarted(recordingId: string): Promise<void>;
    recordingStopped(recordingId: string): Promise<void>;
    close(): Promise<void>;
    readonly activeRecordings: number;
}
/**
 * Phase 1 keeps the daemon-owned lifecycle hook in place but does not launch a
 * keep-awake subprocess yet because recording operations are intentionally
 * stubbed until the native ScreenCaptureKit worker move.
 */
export declare class NoopKeepAwakeController implements KeepAwakeController {
    private readonly recordings;
    get activeRecordings(): number;
    recordingStarted(recordingId: string): Promise<void>;
    recordingStopped(recordingId: string): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=keep-awake.d.ts.map