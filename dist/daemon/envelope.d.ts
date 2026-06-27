import { type ApiErrorBody, type ApiErrorCode, type ApiErrorEnvelope, type ApiRequestEnvelope, type ApiSuccessEnvelope, type ClientSurface, type CoreApiOperation, type CoreApiResult, type DaemonEvent, type DaemonEventEnvelope, type SseFrame, type VerifiedCaller } from '../contract/wire.js';
export interface EnvelopeOptions {
    caller?: VerifiedCaller;
    deliveryPath?: ClientSurface;
    timestamp?: number;
}
export declare function makeRequestId(): string;
export declare function successEnvelope<T extends CoreApiOperation>(request: ApiRequestEnvelope<T>, result: CoreApiResult<T>, options?: EnvelopeOptions): ApiSuccessEnvelope<CoreApiResult<T>>;
export declare function apiErrorBody(error: unknown, code?: ApiErrorCode, retryable?: boolean): ApiErrorBody;
export declare function errorEnvelope(error: unknown, options?: EnvelopeOptions & {
    requestId?: string;
    code?: ApiErrorCode;
    retryable?: boolean;
}): ApiErrorEnvelope;
export declare function unsupportedApiVersionEnvelope(request: Pick<ApiRequestEnvelope, 'apiVersion' | 'requestId'>, options?: EnvelopeOptions): ApiErrorEnvelope;
export declare function eventEnvelope<T extends DaemonEvent>(event: T, options?: EnvelopeOptions & {
    eventId?: string;
}): DaemonEventEnvelope<T>;
export declare function sseFrame<T extends DaemonEvent>(envelope: DaemonEventEnvelope<T>, retry?: number): SseFrame<T>;
export declare function formatSseFrame<T extends DaemonEvent>(frame: SseFrame<T>): string;
//# sourceMappingURL=envelope.d.ts.map