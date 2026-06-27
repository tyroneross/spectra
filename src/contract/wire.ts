// src/contract/wire.ts
//
// Wire contract for the daemon HTTP shape served over the primary Unix domain
// socket. CoreApi stays transport-neutral; this file defines only envelopes,
// event frames, transport policy, and error vocabulary.

import type {
  CaptureRunArtifact,
  CaptureRunRecording,
  CoreApi,
  HealthResult,
  JsonObject,
  JsonValue,
  PermissionStatus,
  SessionSummary,
  WindowRecord,
} from './core-api.js'

export const API_VERSION = 2 as const
export const apiVersion = API_VERSION
export type ApiVersion = typeof API_VERSION

export const primarySocketPath = '~/.spectra/daemon.sock' as const
export const primarySocketMode = '0600' as const
export const eventsRoute = '/api/v1/events' as const
export const mcpRoute = '/mcp' as const

export type CoreApiOperation = keyof CoreApi & string
export type CoreApiParams<T extends CoreApiOperation> = Parameters<CoreApi[T]>[0]
export type CoreApiResult<T extends CoreApiOperation> = Awaited<ReturnType<CoreApi[T]>>
export type ApiV1Route<T extends CoreApiOperation = CoreApiOperation> = `/api/v1/${T}`

export type ClientSurface =
  | 'stdio-mcp'
  | 'cli'
  | 'menubar'
  | 'slash-command'
  | 'http-mcp'
  | 'test'
  | 'unknown'

export type VerifiedBy = 'unix-peer' | 'bearer-token'

export type Capability =
  | 'daemon:read'
  | 'permissions:read'
  | 'permissions:request'
  | 'windows:read'
  | 'sessions:read'
  | 'sessions:write'
  | 'ui:read'
  | 'ui:act'
  | 'analysis:read'
  | 'discover:write'
  | 'media:capture'
  | 'media:record'
  | 'terminal:read'
  | 'terminal:record'
  | 'library:read'
  | 'library:write'
  | 'demo:write'

export interface CallerHint {
  surface: ClientSurface
  name?: string
  pid?: number
}

export interface VerifiedCaller {
  surface: ClientSurface
  verifiedBy: VerifiedBy
  capabilities: Capability[]
  uid?: number
  gid?: number
  pid?: number
  tokenId?: string
}

export const operationCapabilities = {
  health: ['daemon:read'],
  getPermissions: ['permissions:read'],
  requestPermissions: ['permissions:request'],
  listWindows: ['windows:read'],
  createSession: ['sessions:write', 'ui:read'],
  listSessions: ['sessions:read'],
  getSession: ['sessions:read'],
  getRun: ['sessions:read'],
  closeSession: ['sessions:write'],
  closeAllSessions: ['sessions:write'],
  recordLlmUsage: ['sessions:write'],
  snapshot: ['ui:read'],
  observe: ['ui:read'],
  act: ['ui:act'],
  step: ['ui:act'],
  llmStep: ['ui:act'],
  walkthrough: ['ui:act', 'media:capture'],
  screenshot: ['media:capture'],
  startRecording: ['media:record'],
  stopRecording: ['media:record'],
  recordComposite: ['media:record', 'windows:read'],
  analyze: ['analysis:read'],
  discover: ['discover:write', 'ui:act', 'media:capture'],
  recordTerminal: ['terminal:record'],
  replayTerminal: ['terminal:read'],
  library: ['library:read', 'library:write'],
  demo: ['demo:write'],
  autoRampDemo: ['demo:write'],
} as const satisfies Record<CoreApiOperation, readonly Capability[]>

export interface UnixSocketTransportPolicy {
  kind: 'unix-socket'
  primary: true
  socketPath: typeof primarySocketPath
  socketMode: typeof primarySocketMode
  auth: {
    verifyPeerCredentials: true
    defaultDenyCapabilities: true
  }
}

export interface LoopbackHttpTransportPolicy {
  kind: 'loopback-http'
  primary: false
  optInOnly: true
  allowedHosts: readonly ['127.0.0.1', '::1', 'localhost']
  rejectNonLoopbackHost: true
  bearer: {
    required: true
    tokenPath: '~/.spectra/daemon.token'
    tokenFileMode: '0600'
    requiredOnEveryRequest: true
  }
  origin: {
    validate: true
    allowedOrigins: string[]
  }
  routes: readonly ['/api/v1/*', '/api/v1/events', '/mcp']
}

export type DaemonTransportPolicy = UnixSocketTransportPolicy | LoopbackHttpTransportPolicy

export const unixSocketTransportPolicy = {
  kind: 'unix-socket',
  primary: true,
  socketPath: primarySocketPath,
  socketMode: primarySocketMode,
  auth: {
    verifyPeerCredentials: true,
    defaultDenyCapabilities: true,
  },
} as const satisfies UnixSocketTransportPolicy

export const loopbackHttpTransportPolicy = {
  kind: 'loopback-http',
  primary: false,
  optInOnly: true,
  allowedHosts: ['127.0.0.1', '::1', 'localhost'],
  rejectNonLoopbackHost: true,
  bearer: {
    required: true,
    tokenPath: '~/.spectra/daemon.token',
    tokenFileMode: '0600',
    requiredOnEveryRequest: true,
  },
  origin: {
    validate: true,
    allowedOrigins: [],
  },
  routes: ['/api/v1/*', '/api/v1/events', '/mcp'],
} as const satisfies LoopbackHttpTransportPolicy

/*
 * Security decision encoded by the contract:
 * - Primary transport is the Unix domain socket above, mode 0600.
 * - stdio MCP is a forwarding adapter over that socket.
 * - Loopback TCP and Streamable HTTP /mcp are off by default. If enabled, the
 *   daemon must reject non-loopback Host, validate Origin, and require the
 *   bearer token on every request.
 * - Caller identity is not trusted from request JSON. The daemon derives
 *   VerifiedCaller from socket peer credentials or the bearer token, then
 *   grants operationCapabilities by default-deny policy.
 */

export type ApiRequestEnvelope<T extends CoreApiOperation = CoreApiOperation> = {
  apiVersion: ApiVersion
  requestId: string
  operation: T
  caller?: CallerHint
} & (undefined extends CoreApiParams<T>
  ? { params?: CoreApiParams<T> }
  : { params: CoreApiParams<T> })

export interface ApiSuccessEnvelope<TResult = JsonValue> {
  apiVersion: ApiVersion
  requestId: string
  ok: true
  result: TResult
  timestamp: number
  caller?: VerifiedCaller
  deliveryPath?: ClientSurface
}

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unsupported_api_version'
  | 'permission_denied'
  | 'capability_denied'
  | 'capture_failed'
  | 'recording_failed'
  | 'daemon_unhealthy'
  | 'internal_error'

export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
  hint?: string
  details?: JsonValue
  retryable?: boolean
}

export interface ApiErrorEnvelope {
  apiVersion: ApiVersion
  requestId?: string
  ok: false
  error: ApiErrorBody
  timestamp: number
  caller?: VerifiedCaller
  deliveryPath?: ClientSurface
}

export type ApiResponseEnvelope<T extends CoreApiOperation = CoreApiOperation> =
  | ApiSuccessEnvelope<CoreApiResult<T>>
  | ApiErrorEnvelope

export type RecordingEventData = CaptureRunRecording & {
  sessionId: string
}

export type DaemonEvent =
  | {
      type: 'daemon.ready'
      data: {
        apiVersion: ApiVersion
        daemonVersion: string
        pid: number
        aquaSession: boolean
        windowServerConnected: boolean
      }
    }
  | { type: 'daemon.health'; data: HealthResult }
  | { type: 'permission.changed'; data: PermissionStatus }
  | { type: 'windows.changed'; data: { windows: WindowRecord[] } }
  | { type: 'session.created'; sessionId: string; data: { session: SessionSummary } }
  | { type: 'session.closed'; sessionId: string; data: { sessionId: string } }
  | { type: 'snapshot.observed'; sessionId: string; data: { elementCount: number; url?: string; appName?: string } }
  | { type: 'decision.recorded'; sessionId: string; data: { decisionId: string; outcome: string } }
  | { type: 'action.completed'; sessionId: string; data: { stepIndex: number; success: boolean; error?: string } }
  | { type: 'artifact.added'; sessionId: string; data: CaptureRunArtifact }
  | { type: 'recording.status'; sessionId: string; data: RecordingEventData }
  | { type: 'library.changed'; data: { action: string; captureId?: string } }
  | { type: 'error'; sessionId?: string; data: ApiErrorBody }

export type DaemonEventType = DaemonEvent['type']

export type DaemonEventEnvelope<T extends DaemonEvent = DaemonEvent> = {
  apiVersion: ApiVersion
  eventId: string
  type: T['type']
  emittedAt: number
  caller?: VerifiedCaller
  deliveryPath?: ClientSurface
} & ('sessionId' extends keyof T ? { sessionId: T['sessionId'] } : { sessionId?: string })
  & { data: T['data'] }

export interface SseFrame<T extends DaemonEvent = DaemonEvent> {
  event: T['type']
  id: string
  data: DaemonEventEnvelope<T>
  retry?: number
}

export interface EventsSubscribeRequest {
  apiVersion: ApiVersion
  sessionId?: string
  eventTypes?: DaemonEventType[]
  caller?: CallerHint
}

export interface ErrorResponseEnvelope extends ApiErrorEnvelope {}
