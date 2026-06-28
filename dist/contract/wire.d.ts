import type { CaptureRunArtifact, CaptureRunRecording, CoreApi, HealthResult, JsonValue, PermissionStatus, SessionSummary, WindowRecord } from './core-api.js';
export declare const API_VERSION: 2;
export declare const apiVersion: 2;
export type ApiVersion = typeof API_VERSION;
export declare const primarySocketPath: "~/.spectra/daemon.sock";
export declare const primarySocketMode: "0600";
export declare const eventsRoute: "/api/v1/events";
export declare const mcpRoute: "/mcp";
export type CoreApiOperation = keyof CoreApi & string;
export type CoreApiParams<T extends CoreApiOperation> = Parameters<CoreApi[T]>[0];
export type CoreApiResult<T extends CoreApiOperation> = Awaited<ReturnType<CoreApi[T]>>;
export type ApiV1Route<T extends CoreApiOperation = CoreApiOperation> = `/api/v1/${T}`;
export type ClientSurface = 'stdio-mcp' | 'cli' | 'menubar' | 'slash-command' | 'http-mcp' | 'test' | 'unknown';
export type VerifiedBy = 'unix-peer' | 'bearer-token';
export type Capability = 'daemon:read' | 'permissions:read' | 'permissions:request' | 'windows:read' | 'sessions:read' | 'sessions:write' | 'ui:read' | 'ui:act' | 'analysis:read' | 'discover:write' | 'media:capture' | 'media:record' | 'terminal:read' | 'terminal:record' | 'library:read' | 'library:write' | 'demo:write';
export interface CallerHint {
    surface: ClientSurface;
    name?: string;
    pid?: number;
}
export interface VerifiedCaller {
    surface: ClientSurface;
    verifiedBy: VerifiedBy;
    capabilities: Capability[];
    uid?: number;
    gid?: number;
    pid?: number;
    tokenId?: string;
}
export declare const operationCapabilities: {
    readonly health: readonly ["daemon:read"];
    readonly getPermissions: readonly ["permissions:read"];
    readonly requestPermissions: readonly ["permissions:request"];
    readonly listWindows: readonly ["windows:read"];
    readonly createSession: readonly ["sessions:write", "ui:read"];
    readonly listSessions: readonly ["sessions:read"];
    readonly getSession: readonly ["sessions:read"];
    readonly getRun: readonly ["sessions:read"];
    readonly closeSession: readonly ["sessions:write"];
    readonly closeAllSessions: readonly ["sessions:write"];
    readonly recordLlmUsage: readonly ["sessions:write"];
    readonly snapshot: readonly ["ui:read"];
    readonly observe: readonly ["ui:read"];
    readonly act: readonly ["ui:act"];
    readonly step: readonly ["ui:act"];
    readonly llmStep: readonly ["ui:act"];
    readonly walkthrough: readonly ["ui:act", "media:capture"];
    readonly screenshot: readonly ["media:capture"];
    readonly startRecording: readonly ["media:record"];
    readonly stopRecording: readonly ["media:record"];
    readonly recordComposite: readonly ["media:record", "windows:read"];
    readonly getRecording: readonly ["sessions:read"];
    readonly analyze: readonly ["analysis:read"];
    readonly discover: readonly ["discover:write", "ui:act", "media:capture"];
    readonly recordTerminal: readonly ["terminal:record"];
    readonly replayTerminal: readonly ["terminal:read"];
    readonly library: readonly ["library:read", "library:write"];
    readonly demo: readonly ["demo:write"];
    readonly autoRampDemo: readonly ["demo:write"];
};
export interface UnixSocketTransportPolicy {
    kind: 'unix-socket';
    primary: true;
    socketPath: typeof primarySocketPath;
    socketMode: typeof primarySocketMode;
    auth: {
        verifyPeerCredentials: true;
        defaultDenyCapabilities: true;
    };
}
export interface LoopbackHttpTransportPolicy {
    kind: 'loopback-http';
    primary: false;
    optInOnly: true;
    allowedHosts: readonly ['127.0.0.1', '::1', 'localhost'];
    rejectNonLoopbackHost: true;
    bearer: {
        required: true;
        tokenPath: '~/.spectra/daemon.token';
        tokenFileMode: '0600';
        requiredOnEveryRequest: true;
    };
    origin: {
        validate: true;
        allowedOrigins: string[];
    };
    routes: readonly ['/api/v1/*', '/api/v1/events', '/mcp'];
}
export type DaemonTransportPolicy = UnixSocketTransportPolicy | LoopbackHttpTransportPolicy;
export declare const unixSocketTransportPolicy: {
    readonly kind: "unix-socket";
    readonly primary: true;
    readonly socketPath: "~/.spectra/daemon.sock";
    readonly socketMode: "0600";
    readonly auth: {
        readonly verifyPeerCredentials: true;
        readonly defaultDenyCapabilities: true;
    };
};
export declare const loopbackHttpTransportPolicy: {
    readonly kind: "loopback-http";
    readonly primary: false;
    readonly optInOnly: true;
    readonly allowedHosts: readonly ["127.0.0.1", "::1", "localhost"];
    readonly rejectNonLoopbackHost: true;
    readonly bearer: {
        readonly required: true;
        readonly tokenPath: "~/.spectra/daemon.token";
        readonly tokenFileMode: "0600";
        readonly requiredOnEveryRequest: true;
    };
    readonly origin: {
        readonly validate: true;
        readonly allowedOrigins: [];
    };
    readonly routes: readonly ["/api/v1/*", "/api/v1/events", "/mcp"];
};
export type ApiRequestEnvelope<T extends CoreApiOperation = CoreApiOperation> = {
    apiVersion: ApiVersion;
    requestId: string;
    operation: T;
    caller?: CallerHint;
} & (undefined extends CoreApiParams<T> ? {
    params?: CoreApiParams<T>;
} : {
    params: CoreApiParams<T>;
});
export interface ApiSuccessEnvelope<TResult = JsonValue> {
    apiVersion: ApiVersion;
    requestId: string;
    ok: true;
    result: TResult;
    timestamp: number;
    caller?: VerifiedCaller;
    deliveryPath?: ClientSurface;
}
export type ApiErrorCode = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unsupported_api_version' | 'permission_denied' | 'capability_denied' | 'capture_failed' | 'recording_failed' | 'daemon_unhealthy' | 'internal_error';
export interface ApiErrorBody {
    code: ApiErrorCode;
    message: string;
    hint?: string;
    details?: JsonValue;
    retryable?: boolean;
}
export interface ApiErrorEnvelope {
    apiVersion: ApiVersion;
    requestId?: string;
    ok: false;
    error: ApiErrorBody;
    timestamp: number;
    caller?: VerifiedCaller;
    deliveryPath?: ClientSurface;
}
export type ApiResponseEnvelope<T extends CoreApiOperation = CoreApiOperation> = ApiSuccessEnvelope<CoreApiResult<T>> | ApiErrorEnvelope;
export type RecordingEventData = CaptureRunRecording & {
    sessionId: string;
};
export type DaemonEvent = {
    type: 'daemon.ready';
    data: {
        apiVersion: ApiVersion;
        daemonVersion: string;
        pid: number;
        aquaSession: boolean;
        windowServerConnected: boolean;
    };
} | {
    type: 'daemon.health';
    data: HealthResult;
} | {
    type: 'permission.changed';
    data: PermissionStatus;
} | {
    type: 'windows.changed';
    data: {
        windows: WindowRecord[];
    };
} | {
    type: 'session.created';
    sessionId: string;
    data: {
        session: SessionSummary;
    };
} | {
    type: 'session.closed';
    sessionId: string;
    data: {
        sessionId: string;
    };
} | {
    type: 'snapshot.observed';
    sessionId: string;
    data: {
        elementCount: number;
        url?: string;
        appName?: string;
    };
} | {
    type: 'decision.recorded';
    sessionId: string;
    data: {
        decisionId: string;
        outcome: string;
    };
} | {
    type: 'action.completed';
    sessionId: string;
    data: {
        stepIndex: number;
        success: boolean;
        error?: string;
    };
} | {
    type: 'artifact.added';
    sessionId: string;
    data: CaptureRunArtifact;
} | {
    type: 'recording.status';
    sessionId: string;
    data: RecordingEventData;
} | {
    type: 'library.changed';
    data: {
        action: string;
        captureId?: string;
    };
} | {
    type: 'error';
    sessionId?: string;
    data: ApiErrorBody;
};
export type DaemonEventType = DaemonEvent['type'];
export type DaemonEventEnvelope<T extends DaemonEvent = DaemonEvent> = {
    apiVersion: ApiVersion;
    eventId: string;
    type: T['type'];
    emittedAt: number;
    caller?: VerifiedCaller;
    deliveryPath?: ClientSurface;
} & ('sessionId' extends keyof T ? {
    sessionId: T['sessionId'];
} : {
    sessionId?: string;
}) & {
    data: T['data'];
};
export interface SseFrame<T extends DaemonEvent = DaemonEvent> {
    event: T['type'];
    id: string;
    data: DaemonEventEnvelope<T>;
    retry?: number;
}
export interface EventsSubscribeRequest {
    apiVersion: ApiVersion;
    sessionId?: string;
    eventTypes?: DaemonEventType[];
    caller?: CallerHint;
}
export interface ErrorResponseEnvelope extends ApiErrorEnvelope {
}
//# sourceMappingURL=wire.d.ts.map