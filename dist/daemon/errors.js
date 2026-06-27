export class DaemonApiError extends Error {
    code;
    status;
    hint;
    details;
    retryable;
    constructor(code, message, options = {}) {
        super(message, { cause: options.cause });
        this.name = 'DaemonApiError';
        this.code = code;
        this.status = options.status ?? statusForCode(code);
        this.hint = options.hint;
        this.details = options.details;
        this.retryable = options.retryable;
    }
    toBody() {
        return {
            code: this.code,
            message: this.message,
            hint: this.hint,
            details: this.details,
            retryable: this.retryable,
        };
    }
}
export class NotYetImplementedError extends DaemonApiError {
    constructor(operation, nextChunk) {
        super('recording_failed', `NotYetImplemented: ${operation} is stubbed in Phase 1 backend daemon core.`, {
            status: 501,
            hint: nextChunk,
            retryable: false,
        });
        this.name = 'NotYetImplementedError';
    }
}
export function statusForCode(code) {
    switch (code) {
        case 'bad_request':
        case 'unsupported_api_version':
            return 400;
        case 'unauthorized':
            return 401;
        case 'forbidden':
        case 'permission_denied':
        case 'capability_denied':
            return 403;
        case 'not_found':
            return 404;
        case 'conflict':
            return 409;
        case 'daemon_unhealthy':
            return 503;
        case 'capture_failed':
        case 'recording_failed':
        case 'internal_error':
        default:
            return 500;
    }
}
export function toDaemonApiError(error) {
    if (error instanceof DaemonApiError)
        return error;
    const message = error instanceof Error ? error.message : String(error);
    return new DaemonApiError('internal_error', message || 'Internal daemon error', {
        status: 500,
        cause: error,
    });
}
//# sourceMappingURL=errors.js.map