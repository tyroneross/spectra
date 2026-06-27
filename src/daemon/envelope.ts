import { randomUUID } from 'node:crypto'
import {
  API_VERSION,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiErrorEnvelope,
  type ApiRequestEnvelope,
  type ApiSuccessEnvelope,
  type ClientSurface,
  type CoreApiOperation,
  type CoreApiResult,
  type DaemonEvent,
  type DaemonEventEnvelope,
  type SseFrame,
  type VerifiedCaller,
} from '../contract/wire.js'

export interface EnvelopeOptions {
  caller?: VerifiedCaller
  deliveryPath?: ClientSurface
  timestamp?: number
}

export function makeRequestId(): string {
  return randomUUID()
}

export function successEnvelope<T extends CoreApiOperation>(
  request: ApiRequestEnvelope<T>,
  result: CoreApiResult<T>,
  options: EnvelopeOptions = {},
): ApiSuccessEnvelope<CoreApiResult<T>> {
  return {
    apiVersion: API_VERSION,
    requestId: request.requestId,
    ok: true,
    result,
    timestamp: options.timestamp ?? Date.now(),
    caller: options.caller,
    deliveryPath: options.deliveryPath,
  }
}

export function apiErrorBody(
  error: unknown,
  code: ApiErrorCode = 'internal_error',
  retryable = false,
): ApiErrorBody {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const body = error as Partial<ApiErrorBody>
    return {
      code: body.code ?? code,
      message: body.message ?? 'Daemon request failed.',
      hint: body.hint,
      details: body.details,
      retryable: body.retryable ?? retryable,
    }
  }

  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable,
  }
}

export function errorEnvelope(
  error: unknown,
  options: EnvelopeOptions & {
    requestId?: string
    code?: ApiErrorCode
    retryable?: boolean
  } = {},
): ApiErrorEnvelope {
  return {
    apiVersion: API_VERSION,
    requestId: options.requestId,
    ok: false,
    error: apiErrorBody(error, options.code, options.retryable),
    timestamp: options.timestamp ?? Date.now(),
    caller: options.caller,
    deliveryPath: options.deliveryPath,
  }
}

export function unsupportedApiVersionEnvelope(
  request: Pick<ApiRequestEnvelope, 'apiVersion' | 'requestId'>,
  options: EnvelopeOptions = {},
): ApiErrorEnvelope {
  return errorEnvelope(`Unsupported API version: ${request.apiVersion}`, {
    ...options,
    requestId: request.requestId,
    code: 'unsupported_api_version',
  })
}

export function eventEnvelope<T extends DaemonEvent>(
  event: T,
  options: EnvelopeOptions & { eventId?: string } = {},
): DaemonEventEnvelope<T> {
  const sessionId = 'sessionId' in event ? event.sessionId : undefined
  return {
    apiVersion: API_VERSION,
    eventId: options.eventId ?? randomUUID(),
    type: event.type,
    emittedAt: options.timestamp ?? Date.now(),
    caller: options.caller,
    deliveryPath: options.deliveryPath,
    sessionId,
    data: event.data,
  } as unknown as DaemonEventEnvelope<T>
}

export function sseFrame<T extends DaemonEvent>(
  envelope: DaemonEventEnvelope<T>,
  retry?: number,
): SseFrame<T> {
  return {
    event: envelope.type,
    id: envelope.eventId,
    data: envelope,
    retry,
  }
}

export function formatSseFrame<T extends DaemonEvent>(frame: SseFrame<T>): string {
  const lines = [
    `event: ${frame.event}`,
    `id: ${frame.id}`,
    `data: ${JSON.stringify(frame.data)}`,
  ]

  if (frame.retry !== undefined) {
    lines.push(`retry: ${frame.retry}`)
  }

  return `${lines.join('\n')}\n\n`
}
