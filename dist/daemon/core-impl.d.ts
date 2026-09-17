import { type ChildProcess } from 'node:child_process';
import type { AnalyzeParams, AnalyzeResult, AutoRampDemoParams, AutoRampDemoResult, CloseAllSessionsResult, CloseSessionResult, CoreApi, CreateSessionParams, CreateSessionResult, DemoParams, DemoResult, DiscoverParams, DiscoverResult, GetPermissionsParams, GetRunResult, GetSessionResult, HealthParams, HealthResult, LibraryParams, LibraryResult, ListSessionsParams, ListSessionsResult, ListWindowsParams, ListWindowsResult, PermissionStatus, GetRecordingParams, GetRecordingResult, RecordCompositeParams, RecordCompositeResult, RecordLlmUsageParams, RecordLlmUsageResult, RequestPermissionsParams, RequestPermissionsResult, ScreenshotParams, ScreenshotResult, SessionByIdParams, StartRecordingParams, StartRecordingResult, StopRecordingParams, StopRecordingResult, WindowRecord, SnapshotParams, SnapshotResult, ObserveParams, ObserveResult, ActParams, ActResult, StepParams, StepResult, LlmStepParams, LlmStepResult, WalkthroughParams, WalkthroughResult, TerminalRecordParams, TerminalRecordResult, TerminalReplayParams, TerminalReplayResult, ComputerUseParams, ComputerUseResult } from '../contract/core-api.js';
import type { AxBridgePort } from '../computer-use/port.js';
import type { VisionFallback } from '../computer-use/vision-fallback.js';
import type { AxTarget } from '../computer-use/types.js';
import type { DaemonEvent } from '../contract/wire.js';
import { type ToolContext } from '../mcp/context.js';
import { recordCompositeWithWorker } from './composite-worker.js';
import { type HealthProbeOptions } from './health.js';
import type { KeepAwakeController } from './keep-awake.js';
type CompositeWorker = typeof recordCompositeWithWorker;
/** Minimal native-bridge surface the capability handshake needs (fakeable in tests). */
export interface NativeCapabilityBridge {
    send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}
type SingleWindowRecordingRunner = (input: NativeStartRecordingInput) => Promise<NativeRecordingHandle>;
type DaemonEventSink = (event: DaemonEvent) => void;
export interface CoreApiImplementationOptions {
    context?: ToolContext;
    startedAt?: number;
    daemonVersion?: string;
    healthProbe?: HealthProbeOptions;
    keepAwake?: KeepAwakeController;
    recordCompositeWorker?: CompositeWorker;
    singleWindowRecordingRunner?: SingleWindowRecordingRunner;
    windowListProvider?: () => Promise<WindowRecord[]>;
    eventSink?: DaemonEventSink;
    /** Native bridge used for the recording-selector capability handshake. */
    nativeBridge?: NativeCapabilityBridge;
}
export declare function createCoreApi(options?: CoreApiImplementationOptions): CoreApi;
export declare class CoreApiImplementation implements CoreApi {
    private readonly ctx;
    private readonly startedAt;
    private readonly daemonVersion?;
    private readonly healthProbe?;
    private readonly keepAwake;
    private readonly recordCompositeWorker;
    private readonly singleWindowRecordingRunner;
    private readonly windowListProvider;
    private readonly eventSink?;
    private readonly nativeBridge;
    private readonly recordings;
    private readonly compositeRecordings;
    /**
     * One ComputerUse instance per distinct target, reused across MCP calls so
     * its snapshot cache (and the native AX bridge it holds) actually pays off.
     * Previously computerUse() built a fresh ComputerUse per call, so `act`'s
     * cache was always empty and every standalone act fell through to
     * needsVisionFallback regardless of the app (see docs/prd — dead act path).
     * Keyed by target (pid/app) since a snapshot cache scoped to one window is
     * meaningless for another; targets are few and long-lived per session so
     * this map does not grow unbounded in practice.
     */
    private readonly computerUseInstances;
    constructor(options?: CoreApiImplementationOptions);
    /**
     * A pid-bound recording is only safe if the native helper honors the exact
     * selectors. `ensureBinary()` prefers a helper embedded in an installed
     * Spectra.app, and that bundled copy can predate windowId/pid support — it
     * would then quietly fall back to app+title and record the wrong instance.
     * The handshake makes that unreachable: no capability (or an old helper that
     * errors on the unknown method) means no recording.
     */
    private assertPidSelectorSupport;
    protected spawnCursorSampler(binaryPath: string, args: string[]): ChildProcess;
    /** Overridable seam so tests can simulate a missing/failed-to-build binary without compiling. */
    protected ensureCursorSamplerBinary(): string;
    health(params?: HealthParams): Promise<HealthResult>;
    getPermissions(params?: GetPermissionsParams): Promise<{
        permissions: PermissionStatus[];
    }>;
    requestPermissions(params: RequestPermissionsParams): Promise<RequestPermissionsResult>;
    listWindows(params?: ListWindowsParams): Promise<ListWindowsResult>;
    createSession(params: CreateSessionParams): Promise<CreateSessionResult>;
    listSessions(_params?: ListSessionsParams): Promise<ListSessionsResult>;
    getSession(params: SessionByIdParams): Promise<GetSessionResult>;
    getRun(params: SessionByIdParams): Promise<GetRunResult>;
    closeSession(params: SessionByIdParams): Promise<CloseSessionResult>;
    closeAllSessions(): Promise<CloseAllSessionsResult>;
    recordLlmUsage(params: RecordLlmUsageParams): Promise<RecordLlmUsageResult>;
    snapshot(params: SnapshotParams): Promise<SnapshotResult>;
    observe(params: ObserveParams): Promise<ObserveResult>;
    act(params: ActParams): Promise<ActResult>;
    step(params: StepParams): Promise<StepResult>;
    llmStep(params: LlmStepParams): Promise<LlmStepResult>;
    walkthrough(params: WalkthroughParams): Promise<WalkthroughResult>;
    screenshot(params: ScreenshotParams): Promise<ScreenshotResult>;
    startRecording(params: StartRecordingParams): Promise<StartRecordingResult>;
    stopRecording(params: StopRecordingParams): Promise<StopRecordingResult>;
    recordComposite(params: RecordCompositeParams): Promise<RecordCompositeResult>;
    getRecording(params: GetRecordingParams): Promise<GetRecordingResult>;
    private recordCompositeSync;
    private startCompositeRecording;
    private finishCompositeRecording;
    analyze(params: AnalyzeParams): Promise<AnalyzeResult>;
    discover(params: DiscoverParams): Promise<DiscoverResult>;
    recordTerminal(params: TerminalRecordParams): Promise<TerminalRecordResult>;
    replayTerminal(params: TerminalReplayParams): Promise<TerminalReplayResult>;
    library(params: LibraryParams): Promise<LibraryResult>;
    demo(params: DemoParams): Promise<DemoResult>;
    autoRampDemo(params: AutoRampDemoParams): Promise<AutoRampDemoResult>;
    /**
     * AX-first, focused-window-scoped computer use. Builds a ComputerUse over the
     * native AX bridge (overridable seam for tests) and dispatches by action. AX
     * failure modes are mapped to actionable daemon errors, never a crash.
     */
    computerUse(params: ComputerUseParams): Promise<ComputerUseResult>;
    /** Overridable seam so tests can inject a fake AX bridge without a GUI session. */
    protected createAxBridgePort(): AxBridgePort;
    /** Overridable seam so tests can inject or suppress the native vision fallback. */
    protected createVisionFallback(port: AxBridgePort, target: AxTarget): Promise<VisionFallback | undefined>;
    /**
     * Returns the persistent ComputerUse for `target`, constructing it lazily
     * on first use. Reusing the instance across calls is what lets `act`'s
     * lazy self-snapshot (computer-use.ts) actually build up a cache that
     * later act/click/setValue calls in the same target benefit from — a
     * fresh-per-call instance (the pre-fix behavior) never accumulated state.
     */
    private getOrCreateComputerUse;
    close(): Promise<void>;
    protected startCursorSampler(binaryPath: string, recordingId: string, sessionDir: string, fps: number, maxDurationSeconds: number): ActiveCursorSampler;
    private stopCursorSampler;
    private cursorTelemetryPathIfPresent;
    private addCompositeArtifact;
    private emit;
    private emitRecordingStatus;
    private emitArtifactAdded;
    private resolveRecordingTarget;
    /**
     * Title hint disambiguates between several windows of one process/app — it
     * never widens the candidate set, so a pid filter upstream still holds.
     */
    private orderRecordingCandidates;
}
interface NativeStartRecordingInput {
    recordingId: string;
    sessionId: string;
    app: string;
    title?: string;
    /** ScreenCaptureKit window id resolved in TS (from the window list). */
    windowId?: number;
    /** Process id the session is bound to, when pid targeting is in use. */
    pid?: number;
    outPath: string;
    fps: number;
    codec: string;
    bitrate: string;
    captureAudio: boolean;
    maxDurationSeconds: number;
}
interface NativeStartRecordingOutput {
    recordingId: string;
    path: string;
    startedAt?: number;
    fps?: number;
    codec?: string;
    bitrate?: string;
    width?: number;
    height?: number;
}
interface NativeStopRecordingOutput {
    recordingId?: string;
    path?: string;
    format?: string;
    durationMs?: number;
    sizeBytes?: number;
    codec?: string;
    fps?: number;
    width?: number;
    height?: number;
    droppedFrames?: number;
}
interface NativeRecordingHandle {
    pid?: number;
    started: NativeStartRecordingOutput;
    stop(): Promise<NativeStopRecordingOutput>;
    abort(): Promise<void>;
}
interface ActiveCursorSampler {
    child: ChildProcess;
    outPath: string;
}
export {};
//# sourceMappingURL=core-impl.d.ts.map