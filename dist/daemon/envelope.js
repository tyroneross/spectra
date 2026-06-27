import { randomUUID } from 'node:crypto';
import { API_VERSION, } from '../contract/wire.js';
export function makeRequestId() {
    return randomUUID();
}
export function successEnvelope(request, result, options = {}) {
    return {
        apiVersion: API_VERSION,
        requestId: request.requestId,
        ok: true,
        result,
        timestamp: options.timestamp ?? Date.now(),
        caller: options.caller,
        deliveryPath: options.deliveryPath,
    };
}
export function apiErrorBody(error, code = 'internal_error', retryable = false) {
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        const body = error;
        return {
            code: body.code ?? code,
            message: body.message ?? 'Daemon request failed.',
            hint: body.hint,
            details: body.details,
            retryable: body.retryable ?? retryable,
        };
    }
    return {
        code,
        message: error instanceof Error ? error.message : String(error),
        retryable,
    };
}
export function errorEnvelope(error, options = {}) {
    return {
        apiVersion: API_VERSION,
        requestId: options.requestId,
        ok: false,
        error: apiErrorBody(error, options.code, options.retryable),
        timestamp: options.timestamp ?? Date.now(),
        caller: options.caller,
        deliveryPath: options.deliveryPath,
    };
}
export function unsupportedApiVersionEnvelope(request, options = {}) {
    return errorEnvelope(`Unsupported API version: ${request.apiVersion}`, {
        ...options,
        requestId: request.requestId,
        code: 'unsupported_api_version',
    });
}
export function eventEnvelope(event, options = {}) {
    const sessionId = 'sessionId' in event ? event.sessionId : undefined;
    return {
        apiVersion: API_VERSION,
        eventId: options.eventId ?? randomUUID(),
        type: event.type,
        emittedAt: options.timestamp ?? Date.now(),
        caller: options.caller,
        deliveryPath: options.deliveryPath,
        sessionId,
        data: event.data,
    };
}
export function sseFrame(envelope, retry) {
    return {
        event: envelope.type,
        id: envelope.eventId,
        data: envelope,
        retry,
    };
}
export function formatSseFrame(frame) {
    const lines = [
        `event: ${frame.event}`,
        `id: ${frame.id}`,
        `data: ${JSON.stringify(frame.data)}`,
    ];
    if (frame.retry !== undefined) {
        lines.push(`retry: ${frame.retry}`);
    }
    return `${lines.join('\n')}\n\n`;
}
//# sourceMappingURL=envelope.js.map