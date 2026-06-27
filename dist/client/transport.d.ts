/** Expand a leading `~` (or `~/`) to the current user's home directory. */
export declare function expandHome(p: string): string;
export interface SocketResponse {
    status: number;
    /** Parsed JSON body, or the raw string if the body was not JSON. */
    body: unknown;
    raw: string;
}
export interface SocketRequestOptions {
    socketPath: string;
    /** HTTP path, e.g. `/api/v1/health`. */
    path: string;
    method?: 'POST' | 'GET';
    /** Serialized JSON body for POST. */
    body?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
}
/** A connection-level failure (socket missing / refused / timed out). The
 * daemon client treats these as "daemon down" and triggers the fail-open path. */
export declare class SocketConnectionError extends Error {
    readonly cause?: Error;
    readonly syscallCode?: string;
    constructor(message: string, opts?: {
        cause?: Error;
        code?: string;
    });
}
/**
 * Issue a single HTTP request over a unix socket. Resolves with status + parsed
 * body for any HTTP response (including 4xx/5xx). Rejects with
 * SocketConnectionError only for transport-level failures.
 */
export declare function socketRequest(opts: SocketRequestOptions): Promise<SocketResponse>;
//# sourceMappingURL=transport.d.ts.map