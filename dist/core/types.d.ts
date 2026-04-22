export type Platform = 'web' | 'macos' | 'ios' | 'watchos' | 'terminal';
export interface Element {
    id: string;
    role: string;
    label: string;
    value: string | null;
    enabled: boolean;
    focused: boolean;
    actions: string[];
    bounds: [number, number, number, number];
    parent: string | null;
}
export interface Snapshot {
    url?: string;
    appName?: string;
    platform: Platform;
    elements: Element[];
    timestamp: number;
    metadata?: SnapshotMetadata;
}
export interface SnapshotMetadata {
    elementCount: number;
    stableAt?: number;
    timedOut?: boolean;
}
export type ActionType = 'click' | 'type' | 'clear' | 'select' | 'scroll' | 'hover' | 'focus';
export interface Action {
    type: ActionType;
    elementId: string;
    value?: string;
}
export interface ActResult {
    success: boolean;
    error?: string;
    snapshot: Snapshot;
}
export interface DriverTarget {
    url?: string;
    appName?: string;
    deviceId?: string;
    command?: string;
}
export interface Driver {
    connect(target: DriverTarget): Promise<void>;
    snapshot(): Promise<Snapshot>;
    act(elementId: string, action: ActionType, value?: string): Promise<ActResult>;
    screenshot(): Promise<Buffer>;
    /** Navigate to a URL (optional — not all drivers support navigation). */
    navigate?(url: string): Promise<void>;
    /** Expose internal connection for advanced CDP operations (optional). */
    getConnection?(): {
        conn: unknown;
        sessionId: string | null;
    };
    /** End the current session (keep underlying infrastructure alive). */
    close(): Promise<void>;
    /** Full teardown — closes underlying connections/processes. */
    disconnect(): Promise<void>;
}
export interface Session {
    id: string;
    name: string;
    platform: Platform;
    target: DriverTarget;
    steps: Step[];
    createdAt: number;
    updatedAt: number;
    closedAt?: number;
}
export interface Step {
    index: number;
    action: Action;
    snapshotBefore: string;
    snapshotAfter: string;
    screenshotPath: string;
    success: boolean;
    error?: string;
    timestamp: number;
    duration: number;
    intent?: string;
}
export interface ResolveOptions {
    intent: string;
    elements: Element[];
    mode: 'claude' | 'algorithmic';
}
export interface ResolveResult {
    element: Element;
    confidence: number;
    candidates?: Element[];
    visionFallback?: boolean;
}
//# sourceMappingURL=types.d.ts.map