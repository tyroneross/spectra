import type { ApiErrorCode, ClientSurface, CoreApiOperation } from '../contract/wire.js';
export declare const DEFAULT_SOCKET_PATH = "~/.spectra/daemon.sock";
/** Actionable daemon failure. `hint` is always a next step the caller can take;
 * `actionable` is always true so adapters can format it for the user. */
export declare class DaemonError extends Error {
    readonly code: ApiErrorCode | 'daemon_down';
    readonly hint: string;
    readonly retryable: boolean;
    readonly actionable: true;
    constructor(code: ApiErrorCode | 'daemon_down', message: string, hint: string, retryable?: boolean);
    /** Stable JSON shape adapters return to clients. */
    toJSON(): {
        error: string;
        code: string;
        hint: string;
        retryable: boolean;
    };
}
/** Attempt to start the daemon. Resolves true if the daemon became reachable. */
export type BootstrapFn = () => Promise<boolean>;
export interface DaemonClientOptions {
    /** Unix socket path; `~` expanded. Default `~/.spectra/daemon.sock`. */
    socketPath?: string;
    /** Surface label echoed in the request envelope's caller hint. */
    surface?: ClientSurface;
    callerName?: string;
    /** Per-request timeout. Default 30s. */
    timeoutMs?: number;
    /** Health-probe timeout. Default 1s. */
    probeTimeoutMs?: number;
    /** Auto-bootstrap hook invoked once when the daemon is found down. */
    bootstrap?: BootstrapFn;
    /** Validate params against the frozen schema before sending. Default true. */
    validateParams?: boolean;
}
export declare class DaemonClient {
    private readonly socketPath;
    private readonly surface;
    private readonly callerName?;
    private readonly timeoutMs;
    private readonly probeTimeoutMs;
    private readonly bootstrap?;
    private readonly validateParams;
    constructor(opts?: DaemonClientOptions);
    /** Light health probe — returns true if the daemon answers the `health` op. */
    isUp(): Promise<boolean>;
    /**
     * Forward a CoreApi operation to the daemon. On daemon-down, runs the
     * fail-open ladder (probe → bootstrap → re-probe) before throwing an
     * actionable DaemonError. On an HTTP error envelope, throws a DaemonError
     * carrying the daemon's code + message + hint.
     */
    call<T = unknown>(operation: CoreApiOperation, params?: unknown): Promise<T>;
    private prepareParams;
    private callOnce;
    private failOpenRetry;
    private fromErrorBody;
}
//# sourceMappingURL=daemon-client.d.ts.map