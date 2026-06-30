export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
export type TimestampMs = number;
export type IsoTimestamp = string;
export type Base64Png = string;
export type Bounds = [number, number, number, number];
export type Platform = 'web' | 'macos' | 'ios' | 'watchos' | 'terminal';
export type LibraryPlatform = Platform | 'unknown';
export type CaptureMode = 'full' | 'element' | 'region' | 'auto';
export type CapturePreset = 'docs' | 'demo' | 'social' | 'app-store';
export type CaptureQuality = 'lossless' | 'high' | 'medium';
export type VideoCodec = 'h264' | 'hevc';
export type VideoBitrate = '4M' | '8M';
export type RecordingFps = 30 | 60;
export type ActionType = 'click' | 'type' | 'clear' | 'select' | 'scroll' | 'hover' | 'focus';
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface Size {
    width: number;
    height: number;
}
export interface Viewport {
    width: number;
    height: number;
    devicePixelRatio?: number;
}
export interface ElementSummary {
    id: string;
    role: string;
    label: string;
    value: string | null;
    enabled: boolean;
    focused: boolean;
    actions: string[];
    bounds: Bounds;
    parent: string | null;
}
export interface DriverTarget {
    url?: string;
    appName?: string;
    deviceId?: string;
    command?: string;
}
export interface SnapshotData {
    url?: string;
    appName?: string;
    platform: Platform;
    elements: ElementSummary[];
    timestamp: TimestampMs;
    metadata?: {
        elementCount: number;
        stableAt?: TimestampMs;
        timedOut?: boolean;
    };
}
export interface Action {
    type: ActionType;
    elementId: string;
    value?: string;
}
export type PermissionKind = 'accessibility' | 'screen-recording' | 'automation' | 'developer-tools';
export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unsupported' | 'unknown';
export interface PermissionStatus {
    permission: PermissionKind;
    state: PermissionState;
    requiredFor: string[];
    canPrompt: boolean;
    settingsUrl?: string;
    message?: string;
    lastCheckedAt: TimestampMs;
}
export interface GetPermissionsParams {
    permissions?: PermissionKind[];
}
export interface PermissionsResult {
    permissions: PermissionStatus[];
}
export interface RequestPermissionsParams {
    permissions: PermissionKind[];
    prompt?: boolean;
    openSettings?: boolean;
}
export interface RequestPermissionsResult extends PermissionsResult {
    requested: PermissionKind[];
}
export interface WindowRecord {
    windowId: number;
    appName: string;
    bundleIdentifier?: string;
    processId: number;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    onScreen: boolean;
    active?: boolean | null;
    layer: number;
}
export interface ListWindowsParams {
    app?: string;
    title?: string;
    onScreenOnly?: boolean;
}
export interface ListWindowsResult {
    windows: WindowRecord[];
}
export interface HealthParams {
    includePermissions?: boolean;
}
export interface HealthResult {
    ok: boolean;
    apiVersion: 2;
    daemonVersion: string;
    pid: number;
    uptimeSec: number;
    startedAt?: TimestampMs;
    aquaSession: boolean;
    windowServer: {
        connected: boolean;
        error?: string;
    };
    permissions?: PermissionStatus[];
}
export interface CreateSessionParams {
    target: string;
    name?: string;
    record?: boolean;
    repoPath?: string;
}
export interface LaunchInfo {
    kind: string;
    pid?: number;
    url?: string;
    appName?: string;
}
export interface CreateSessionResult {
    sessionId: string;
    platform: Platform;
    elementCount: number;
    snapshot: string;
    launched?: LaunchInfo;
}
export type CaptureRunStatus = 'active' | 'closed' | 'failed';
export type CaptureRunPlannerSource = 'host-agent' | 'standalone-fallback' | 'manual' | 'unknown';
export type CaptureRunDecisionOutcome = 'auto-executed' | 'needs-host-decision' | 'manual' | 'planned' | 'failed';
export type CaptureRunRecordingState = 'idle' | 'arming' | 'recording' | 'encoding' | 'saved' | 'failed' | 'aborted';
export interface SessionRecord {
    id: string;
    name: string;
    platform: Platform;
    target: DriverTarget;
    steps: SessionStep[];
    createdAt: TimestampMs;
    updatedAt: TimestampMs;
    closedAt?: TimestampMs;
    storageRoot?: string;
    launchedProcess?: {
        pid?: number;
        kind: string;
        killOnDisconnect: boolean;
    };
}
export interface SessionStep {
    index: number;
    action: Action;
    snapshotBefore: string;
    snapshotAfter: string;
    screenshotPath: string;
    success: boolean;
    error?: string;
    timestamp: TimestampMs;
    duration: number;
    intent?: string;
    decisionId?: string;
}
export interface SessionSummary {
    id: string;
    name: string;
    platform: Platform;
    steps: number;
    recordingState: CaptureRunRecordingState;
    createdAt: IsoTimestamp;
}
export interface ListSessionsParams {
    includeClosed?: boolean;
}
export interface ListSessionsResult {
    sessions: SessionSummary[];
}
export interface SessionByIdParams {
    sessionId: string;
}
export interface GetSessionResult {
    session: SessionRecord;
    run: CaptureRunManifest | null;
}
export interface GetRunResult {
    run: CaptureRunManifest;
}
export interface CloseSessionResult {
    success: true;
}
export interface CloseAllSessionsResult {
    success: true;
}
export interface RecordLlmUsageParams {
    sessionId: string;
    usage: JsonValue;
}
export interface RecordLlmUsageResult {
    success: true;
    path: string;
    entries: number;
}
export interface CaptureRunCandidate {
    id: string;
    role: string;
    label: string;
    confidence?: number;
}
export interface CaptureRunDecision {
    id: string;
    timestamp: TimestampMs;
    tool: string;
    plannerSource: CaptureRunPlannerSource;
    intent?: string;
    mode?: 'claude' | 'algorithmic';
    confidence?: number;
    outcome: CaptureRunDecisionOutcome;
    selected?: CaptureRunCandidate;
    candidates?: CaptureRunCandidate[];
    action?: Action;
    actionReason?: string;
    visionFallback?: boolean;
    stepIndex?: number;
    error?: string;
}
export interface CaptureRunAction {
    stepIndex: number;
    timestamp: TimestampMs;
    tool?: string;
    plannerSource?: CaptureRunPlannerSource;
    intent?: string;
    action: Action;
    snapshotBefore: string;
    snapshotAfter: string;
    screenshotPath: string;
    success: boolean;
    error?: string;
    duration: number;
    decisionId?: string;
}
export interface CaptureRunArtifact {
    id: string;
    type: 'screenshot' | 'video' | 'raw-video' | 'snapshot' | 'other';
    path: string;
    format?: string;
    label?: string;
    createdAt: TimestampMs;
    stepIndex?: number;
    sizeBytes?: number;
    metadata?: JsonObject;
}
export interface CaptureRunRecording {
    state: CaptureRunRecordingState;
    recordingId?: string;
    preset?: CapturePreset;
    startedAt?: TimestampMs;
    stoppedAt?: TimestampMs;
    rawPath?: string;
    path?: string;
    durationMs?: number;
    sizeBytes?: number;
    codec?: string;
    fps?: number;
    width?: number;
    height?: number;
    bitrate?: string;
    droppedFrames?: number;
    error?: string;
    source?: string;
    sourceVerified?: boolean;
}
export interface CaptureRunEventRecord {
    id: string;
    timestamp: TimestampMs;
    type: string;
    summary: string;
    data?: JsonObject;
}
export interface CaptureRunManifest {
    schemaVersion: 1;
    runId: string;
    sessionId: string;
    name: string;
    platform: Platform;
    target: DriverTarget;
    planner: {
        source: CaptureRunPlannerSource;
        note?: string;
    };
    status: CaptureRunStatus;
    recording: CaptureRunRecording;
    stats: {
        steps: number;
        screenshots: number;
        videos: number;
        errors: number;
    };
    decisions: CaptureRunDecision[];
    actions: CaptureRunAction[];
    artifacts: CaptureRunArtifact[];
    events: CaptureRunEventRecord[];
    createdAt: TimestampMs;
    updatedAt: TimestampMs;
    closedAt?: TimestampMs;
}
export interface SnapshotParams {
    sessionId: string;
    screenshot?: boolean;
}
export interface SnapshotResult {
    snapshot: string;
    elementCount: number;
    url?: string;
    appName?: string;
    screenshot?: Base64Png;
}
export interface ObserveParams {
    sessionId: string;
    screenshot?: boolean;
    analyze?: boolean;
    viewport?: Viewport;
}
export interface ObserveResult extends SnapshotResult {
    sessionId: string;
    platform?: Platform;
    recording?: CaptureRunRecording;
    analysis?: AnalyzeResult;
}
export interface ActParams {
    sessionId: string;
    elementId: string;
    action: ActionType;
    value?: string;
}
export interface ActResult {
    success: boolean;
    error?: string;
    snapshot: string;
}
export interface StepParams {
    sessionId: string;
    intent: string;
}
export interface StepResult {
    snapshot: string;
    candidates?: Array<{
        id: string;
        role: string;
        label: string;
    }>;
    autoExecuted?: boolean;
    action?: string;
    actionReason?: string;
    error?: string;
    visionFallback?: boolean;
    screenshot?: Base64Png;
}
export interface ActionPlanStep {
    type: ActionType;
    elementId: string;
    value?: string;
    intent?: string;
    waitAfterMs?: number;
}
export interface LlmStepParams {
    sessionId: string;
    actions: ActionPlanStep[];
    continueOnError?: boolean;
}
export interface LlmStepResult {
    sessionId: string;
    stepsExecuted: number;
    stepsTotal: number;
    success: boolean;
    results: Array<{
        index: number;
        intent?: string;
        type: ActionType;
        elementId: string;
        success: boolean;
        error?: string;
        durationMs: number;
    }>;
    finalSnapshot?: string;
}
export interface WalkthroughParams {
    sessionId: string;
    steps: Array<{
        intent: string;
        capture?: boolean;
        waitMs?: number;
    }>;
    clean?: boolean;
}
export interface WalkthroughStepResult {
    index: number;
    intent: string;
    action?: string;
    autoExecuted: boolean;
    success: boolean;
    error?: string;
    screenshotPath?: string;
    state?: string;
    elementCount: number;
}
export interface WalkthroughResult {
    success: boolean;
    stepsCompleted: number;
    stepsTotal: number;
    results: WalkthroughStepResult[];
    duration_ms: number;
}
export interface ScreenshotParams {
    sessionId: string;
    preset?: CapturePreset;
    mode?: CaptureMode;
    elementId?: string;
    region?: string;
    aspectRatio?: string;
    clean?: boolean;
    quality?: CaptureQuality;
}
export interface ScreenshotResult {
    path?: string;
    format?: string;
    preset?: CapturePreset;
    crop?: Bounds;
    label?: string;
    cleanApplied?: boolean;
    error?: string;
}
export interface RecordingCompositePane {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface RecordingCompositeOptions {
    enabled?: boolean;
    displayWidth?: number;
    displayHeight?: number;
    left?: RecordingCompositePane;
    right?: RecordingCompositePane;
}
export interface StartRecordingParams {
    sessionId: string;
    preset?: CapturePreset;
    fps?: RecordingFps;
    codec?: VideoCodec;
    bitrate?: VideoBitrate;
    hardware?: boolean;
    captureAudio?: boolean;
    composite?: RecordingCompositeOptions;
}
export interface StartRecordingResult {
    recordingId?: string;
    preset?: CapturePreset;
    startedAt?: TimestampMs;
    fps?: number;
    codec?: string;
    bitrate?: string;
    error?: string;
}
export interface StopRecordingParams {
    sessionId: string;
    preset?: CapturePreset;
}
export interface StopRecordingResult {
    recordingId?: string;
    preset?: CapturePreset;
    path?: string;
    format?: string;
    durationMs?: number;
    sizeBytes?: number;
    codec?: string;
    fps?: number;
    width?: number;
    height?: number;
    droppedFrames?: number;
    alreadyStopped?: boolean;
    error?: string;
}
export interface BlackFrameGuard {
    sampleCount: number;
    meanLuma: number | null;
    allBlack: boolean;
    skipped: boolean;
}
export type CompositeSpotlight = 'none' | 'a' | 'b';
export type RecordingKind = 'single-window' | 'composite';
export interface RecordingStatus {
    recordingId: string;
    kind: RecordingKind;
    state: CaptureRunRecordingState;
    sessionId?: string;
    startedAt: TimestampMs;
    updatedAt: TimestampMs;
    stoppedAt?: TimestampMs;
    outPath?: string;
    path?: string;
    artifactId?: string;
    error?: string;
}
export interface GetRecordingParams {
    recordingId: string;
}
export interface GetRecordingResult {
    recording: RecordingStatus;
}
export interface RecordCompositeParams {
    appA: string;
    titleA?: string;
    labelA?: string;
    appB: string;
    titleB?: string;
    labelB?: string;
    durationSeconds?: number;
    fps?: number;
    spotlight?: CompositeSpotlight;
    caption?: string;
    cursor?: boolean;
    maxWidth?: number;
    crf?: number;
    outPath: string;
    sessionId?: string;
    async?: boolean;
}
export interface RecordCompositeCompletedResult {
    ok: boolean;
    recordingId?: string;
    output?: string;
    command: string;
    validation?: JsonValue;
    details?: JsonValue;
    blackFrameGuard: BlackFrameGuard;
    warnings: string[];
    error?: string;
    errorCode?: string;
    hint?: string;
    retryable?: boolean;
    artifactId?: string;
}
export interface RecordCompositeAcceptedResult {
    ok: true;
    accepted: true;
    async: true;
    recordingId: string;
    state: 'recording';
    startedAt: TimestampMs;
    sessionId?: string;
    poll: {
        operation: 'getRecording';
        params: GetRecordingParams;
    };
}
export type RecordCompositeResult = RecordCompositeCompletedResult | RecordCompositeAcceptedResult;
export interface AnalyzeParams {
    sessionId: string;
    viewport?: Viewport;
}
export interface AnalyzeResult {
    state: string;
    stateConfidence: number;
    regions: Array<{
        label: string;
        score: number;
        bounds: Bounds;
        elementCount: number;
    }>;
    topElements: Array<{
        id: string;
        role: string;
        label: string;
        importance: number;
        bounds: Bounds;
    }>;
    totalElements: number;
    consoleErrors: Array<{
        type: string;
        text: string;
        url?: string;
    }>;
}
export interface DiscoverParams {
    sessionId: string;
    maxDepth?: number;
    maxScreens?: number;
    captureStates?: boolean;
    clean?: boolean;
    outputDir?: string;
}
export interface DiscoverResult {
    screens: number;
    captures: number;
    sensitive: string[];
    manifestPath: string;
    outputDir: string;
}
export interface TerminalRecordParams {
    command: string;
    timeout?: number;
    watch_files?: string[];
    outputDir?: string;
}
export interface TerminalRecordResult {
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
export interface TerminalReplayParams {
    file: string;
    search?: string;
    commands_only?: boolean;
}
export interface TerminalReplayResult {
    summary: string;
    events?: Array<{
        time: number;
        type: string;
        data: string;
    }>;
    commands?: string[];
    matchCount?: number;
}
export type LibraryCaptureType = 'screenshot' | 'video' | 'walkthrough';
export type LibraryGroupBy = 'feature' | 'date' | 'component' | 'platform' | 'type';
export interface LibraryCaptureEntry {
    id: string;
    created_at: IsoTimestamp;
    type: LibraryCaptureType;
    format: string;
    size_bytes: number;
    duration_ms?: number;
    source: string;
    platform: LibraryPlatform;
    url?: string;
    viewport?: string;
    selector?: string;
    device_name?: string;
    title?: string;
    feature?: string;
    component?: string;
    tags?: string[];
    starred?: boolean;
    walkthrough?: {
        step_count: number;
        steps: string[];
    };
    git_branch?: string;
    git_commit?: string;
}
export interface LibraryFilters {
    tagsAny?: string[];
    tagsAll?: string[];
    feature?: string;
    component?: string;
    platform?: LibraryPlatform;
    type?: LibraryCaptureType;
    since?: string;
    until?: string;
    starred?: boolean;
    text?: string;
    limit?: number;
}
export type LibraryParams = LibraryAddParams | LibraryFindParams | LibraryGalleryParams | LibraryGetParams | LibraryTagParams | LibraryDeleteParams | LibraryStatusParams | LibraryExportParams | LibraryMigrateFromShowcaseParams;
export interface LibraryAddParams {
    action: 'add';
    sourcePath: string;
    type?: LibraryCaptureType;
    platform?: LibraryPlatform;
    url?: string;
    viewport?: string;
    selector?: string;
    deviceName?: string;
    title?: string;
    feature?: string;
    component?: string;
    tags?: string[];
    starred?: boolean;
    walkthrough?: LibraryCaptureEntry['walkthrough'];
    durationMs?: number;
    gitBranch?: string;
    gitCommit?: string;
}
export interface LibraryFindParams extends LibraryFilters {
    action: 'find';
}
export interface LibraryGalleryParams {
    action: 'gallery';
    groupBy?: LibraryGroupBy;
}
export interface LibraryGetParams {
    action: 'get';
    id: string;
}
export interface LibraryTagParams {
    action: 'tag';
    id: string;
    tags?: string[];
    feature?: string;
    component?: string;
    starred?: boolean;
    title?: string;
}
export interface LibraryDeleteParams {
    action: 'delete';
    id: string;
}
export interface LibraryStatusParams {
    action: 'status';
}
export interface LibraryExportParams extends LibraryFilters {
    action: 'export';
    outDir: string;
    flatten?: boolean;
    manifest?: boolean;
}
export interface LibraryMigrateFromShowcaseParams {
    action: 'migrate-from-showcase';
    showcasePath?: string;
}
export type LibraryResult = {
    added: string;
    path: string;
    entry: LibraryCaptureEntry;
} | {
    count: number;
    captures: LibraryCaptureSummary[];
} | LibraryGalleryResult | {
    found: false;
    id: string;
} | {
    found: true;
    entry: LibraryCaptureEntry;
} | {
    updated: false;
    id: string;
} | {
    updated: true;
    entry: LibraryCaptureEntry;
} | {
    removed: false;
    id: string;
} | {
    removed: true;
    id: string;
} | LibraryStatusResult | LibraryExportResult | LibraryMigrationReport;
export interface LibraryCaptureSummary {
    id: string;
    title?: string;
    type: LibraryCaptureType;
    platform: LibraryPlatform;
    feature?: string;
    component?: string;
    tags?: string[];
    url?: string;
    created_at: IsoTimestamp;
    starred?: boolean;
    summary: string;
}
export interface LibraryGalleryResult {
    total: number;
    groupedBy: LibraryGroupBy;
    groups: Array<{
        key: string;
        count: number;
        captures: Array<{
            id: string;
            title?: string;
            type: LibraryCaptureType;
            platform: LibraryPlatform;
            created_at: IsoTimestamp;
            starred?: boolean;
        }>;
    }>;
}
export interface LibraryStatusResult {
    library_version: number;
    total: number;
    by_type: Record<string, number>;
    by_platform: Record<string, number>;
    by_feature: Record<string, number>;
    total_size_bytes: number;
    starred_count: number;
    oldest?: IsoTimestamp;
    newest?: IsoTimestamp;
    total_size_mb: number;
}
export interface LibraryExportResult {
    exported: number;
    outDir: string;
    filesCopied: number;
    manifestPath?: string;
}
export interface LibraryMigrationReport {
    sourcePath: string;
    found: number;
    imported: number;
    skipped: number;
    mediaCopied: number;
    mediaMissing: number;
    issues: string[];
}
export interface DemoScanParams {
    action: 'scan';
    input: string;
    threshold?: number;
}
export interface DemoScanResult {
    perMinute: Array<{
        minute: number;
        changes: number;
    }>;
    activeRanges: Array<{
        startSec: number;
        endSec: number;
    }>;
}
export interface FocalRect {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface CanvasSize {
    w: number;
    h: number;
}
export interface PolishSegmentSpec {
    input: string;
    startSec: number;
    durationSec: number;
    focal: FocalRect;
    caption?: string;
    captionPngPath?: string;
}
export interface PolishDemoSpec {
    canvas: CanvasSize;
    fps?: number;
    segments: PolishSegmentSpec[];
    speed?: number;
}
export interface DemoPolishParams {
    action: 'polish';
    spec: PolishDemoSpec;
    out: string;
}
export interface DemoPolishResult {
    out: string;
    segmentCount: number;
    warnings: string[];
}
export interface AutoRampDemoParams {
    input: string;
    out: string;
    deadSpeed?: number;
    minDeadSec?: number;
    padSec?: number;
    threshold?: number;
    maxWidth?: number;
    crf?: number;
    fps?: number;
}
export interface DemoAutoRampParams extends AutoRampDemoParams {
    action: 'auto-ramp';
}
export interface RampSegment {
    startSec: number;
    durationSec: number;
    speed: number;
}
export interface AutoRampDemoResult {
    out: string;
    segments: RampSegment[];
    inputDuration: number;
    outputDuration: number;
}
export interface DemoRecordCompositeParams extends RecordCompositeParams {
    action: 'record-composite';
}
export type DemoParams = DemoScanParams | DemoPolishParams | DemoAutoRampParams | DemoRecordCompositeParams;
export type DemoResult = DemoScanResult | DemoPolishResult | AutoRampDemoResult | RecordCompositeResult;
export interface CoreApi {
    health(params?: HealthParams): Promise<HealthResult>;
    getPermissions(params?: GetPermissionsParams): Promise<PermissionsResult>;
    requestPermissions(params: RequestPermissionsParams): Promise<RequestPermissionsResult>;
    listWindows(params?: ListWindowsParams): Promise<ListWindowsResult>;
    createSession(params: CreateSessionParams): Promise<CreateSessionResult>;
    listSessions(params?: ListSessionsParams): Promise<ListSessionsResult>;
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
    analyze(params: AnalyzeParams): Promise<AnalyzeResult>;
    discover(params: DiscoverParams): Promise<DiscoverResult>;
    recordTerminal(params: TerminalRecordParams): Promise<TerminalRecordResult>;
    replayTerminal(params: TerminalReplayParams): Promise<TerminalReplayResult>;
    library(params: LibraryParams): Promise<LibraryResult>;
    demo(params: DemoParams): Promise<DemoResult>;
    autoRampDemo(params: AutoRampDemoParams): Promise<AutoRampDemoResult>;
}
//# sourceMappingURL=core-api.d.ts.map