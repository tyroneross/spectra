import type { ApiErrorBody, ApiErrorCode } from '../contract/wire.js';
import type { JsonValue } from '../contract/core-api.js';
export declare class DaemonApiError extends Error {
    readonly code: ApiErrorCode;
    readonly status: number;
    readonly hint?: string;
    readonly details?: JsonValue;
    readonly retryable?: boolean;
    constructor(code: ApiErrorCode, message: string, options?: {
        status?: number;
        hint?: string;
        details?: JsonValue;
        retryable?: boolean;
        cause?: unknown;
    });
    toBody(): ApiErrorBody;
}
export declare class NotYetImplementedError extends DaemonApiError {
    constructor(operation: string, nextChunk: string);
}
export declare function statusForCode(code: ApiErrorCode): number;
export declare function toDaemonApiError(error: unknown): DaemonApiError;
//# sourceMappingURL=errors.d.ts.map