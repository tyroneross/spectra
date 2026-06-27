// src/client/daemon-client.ts
//
// Caller-agnostic daemon client. Every Spectra adapter (stdio MCP, CLI,
// menu-bar) talks to the GUI-session daemon through this client over the unix
// socket. The client owns three contract-critical behaviours from the aligned
// plan (§3.5 fail-open + delivery_path labeling):
//
//   1. Validate params against the frozen Zod schemas before sending (fail
//      fast with a clean message; wires the freeze into the runtime path).
//   2. Speak the frozen wire envelope (apiVersion 2, requestId, operation).
//   3. Fail-open on daemon-down: health-probe → auto-bootstrap (injected) →
//      re-probe → ACTIONABLE error. Never surface a raw CGS_REQUIRE_INIT or a
//      bare ECONNREFUSED to the caller.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { randomUUID } from 'node:crypto'
import { API_VERSION } from '../contract/wire.js'
import type {
  ApiErrorBody,
  ApiErrorCode,
  ApiRequestEnvelope,
  ClientSurface,
  CoreApiOperation,
} from '../contract/wire.js'
import type { RecordCompositeParams } from '../contract/core-api.js'
import { operationParamSchemas } from '../contract/schemas.js'
import {
  expandHome,
  socketRequest,
  SocketConnectionError,
} from './transport.js'

export const DEFAULT_SOCKET_PATH = '~/.spectra/daemon.sock'
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
export const RECORD_COMPOSITE_TIMEOUT_BUFFER_MS = 120_000

/** Actionable daemon failure. `hint` is always a next step the caller can take;
 * `actionable` is always true so adapters can format it for the user. */
export class DaemonError extends Error {
  readonly code: ApiErrorCode | 'daemon_down'
  readonly hint: string
  readonly retryable: boolean
  readonly actionable = true as const
  constructor(code: ApiErrorCode | 'daemon_down', message: string, hint: string, retryable = false) {
    super(message)
    this.name = 'DaemonError'
    this.code = code
    this.hint = hint
    this.retryable = retryable
  }
  /** Stable JSON shape adapters return to clients. */
  toJSON(): { error: string; code: string; hint: string; retryable: boolean } {
    return { error: this.message, code: this.code, hint: this.hint, retryable: this.retryable }
  }
}

const DAEMON_DOWN_HINT =
  'The Spectra daemon is not running. Start the Spectra menu-bar app (it owns ' +
  'screen capture in a GUI session), or run `spectra daemon` from a logged-in ' +
  'desktop session. The daemon must run inside the window server to capture ' +
  'screenshots and video.'

/** Attempt to start the daemon. Resolves true if the daemon became reachable. */
export type BootstrapFn = () => Promise<boolean>

export interface DaemonClientOptions {
  /** Unix socket path; `~` expanded. Default `~/.spectra/daemon.sock`. */
  socketPath?: string
  /** Surface label echoed in the request envelope's caller hint. */
  surface?: ClientSurface
  callerName?: string
  /** Per-request timeout. Default 30s. */
  timeoutMs?: number
  /** Health-probe timeout. Default 1s. */
  probeTimeoutMs?: number
  /** Auto-bootstrap hook invoked once when the daemon is found down. */
  bootstrap?: BootstrapFn
  /** Validate params against the frozen schema before sending. Default true. */
  validateParams?: boolean
}

export class DaemonClient {
  private readonly socketPath: string
  private readonly surface: ClientSurface
  private readonly callerName?: string
  private readonly timeoutMs: number
  private readonly probeTimeoutMs: number
  private readonly bootstrap?: BootstrapFn
  private readonly validateParams: boolean

  constructor(opts: DaemonClientOptions = {}) {
    this.socketPath = expandHome(opts.socketPath ?? DEFAULT_SOCKET_PATH)
    this.surface = opts.surface ?? 'unknown'
    this.callerName = opts.callerName
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.probeTimeoutMs = opts.probeTimeoutMs ?? 1_000
    this.bootstrap = opts.bootstrap
    this.validateParams = opts.validateParams ?? true
  }

  /** Light health probe — returns true if the daemon answers the `health` op. */
  async isUp(): Promise<boolean> {
    try {
      await this.callOnce('health', {}, this.probeTimeoutMs)
      return true
    } catch (err) {
      if (err instanceof SocketConnectionError) return false
      // An HTTP-level error (e.g. capability_denied) still means the daemon is up.
      if (err instanceof DaemonError && err.code === 'daemon_down') return false
      return true
    }
  }

  /**
   * Forward a CoreApi operation to the daemon. On daemon-down, runs the
   * fail-open ladder (probe → bootstrap → re-probe) before throwing an
   * actionable DaemonError. On an HTTP error envelope, throws a DaemonError
   * carrying the daemon's code + message + hint.
   */
  async call<T = unknown>(operation: CoreApiOperation, params?: unknown): Promise<T> {
    const validated = this.prepareParams(operation, params)
    const timeoutMs = timeoutForOperation(operation, validated, this.timeoutMs)
    try {
      return await this.callOnce<T>(operation, validated, timeoutMs)
    } catch (err) {
      if (err instanceof SocketConnectionError) {
        return await this.failOpenRetry<T>(operation, validated, timeoutMs)
      }
      throw err
    }
  }

  // ─── Internals ───────────────────────────────────────────────

  private prepareParams(operation: CoreApiOperation, params: unknown): unknown {
    // Strip undefined keys so the wire envelope stays clean.
    const cleaned = stripUndefined(params)
    if (!this.validateParams) return cleaned
    const schema = operationParamSchemas[operation]
    const result = schema.safeParse(cleaned ?? undefined)
    if (!result.success) {
      throw new DaemonError(
        'bad_request',
        `Invalid params for ${operation}: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        `Check the ${operation} arguments against the spectra contract (apiVersion ${API_VERSION}).`,
      )
    }
    return result.data
  }

  private async callOnce<T>(operation: CoreApiOperation, params: unknown, timeoutMs: number): Promise<T> {
    const envelope: ApiRequestEnvelope = {
      apiVersion: API_VERSION,
      requestId: randomUUID(),
      operation,
      caller: { surface: this.surface, name: this.callerName },
      params: params as ApiRequestEnvelope['params'],
    }
    const res = await socketRequest({
      socketPath: this.socketPath,
      path: `/api/v1/${operation}`,
      method: 'POST',
      body: JSON.stringify(envelope),
      headers: { 'x-request-id': envelope.requestId },
      timeoutMs,
    })

    const parsed = res.body as
      | { ok: true; result: T }
      | { ok: false; error: ApiErrorBody }
      | undefined

    if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
      if (parsed.ok === true) return parsed.result
      throw this.fromErrorBody(parsed.error, res.status)
    }
    // Non-envelope response — surface an actionable wrapper, never the raw body.
    throw new DaemonError(
      res.status >= 500 ? 'internal_error' : 'bad_request',
      `Daemon returned a non-contract response (HTTP ${res.status}) for ${operation}`,
      'The daemon may be running an incompatible build. Restart the Spectra app or rebuild the daemon.',
    )
  }

  private async failOpenRetry<T>(
    operation: CoreApiOperation,
    params: unknown,
    timeoutMs: number,
  ): Promise<T> {
    // Daemon appears down. Try a fast probe first (covers a transient blip).
    if (await this.isUp()) {
      return await this.callOnce<T>(operation, params, timeoutMs)
    }
    // Still down → attempt the injected bootstrap once.
    if (this.bootstrap) {
      const ok = await this.bootstrap().catch(() => false)
      if (ok && (await this.isUp())) {
        return await this.callOnce<T>(operation, params, timeoutMs)
      }
    }
    throw new DaemonError('daemon_down', `Spectra daemon is not reachable for ${operation}.`, DAEMON_DOWN_HINT, true)
  }

  private fromErrorBody(body: ApiErrorBody, status: number): DaemonError {
    const message = body?.message ?? `Daemon error (HTTP ${status})`
    const code = (body?.code ?? 'internal_error') as ApiErrorCode
    // Never let a raw core init error reach the caller — re-frame to an action.
    if (/CGS_REQUIRE_INIT|window server|WindowServer/i.test(message)) {
      return new DaemonError(
        'daemon_unhealthy',
        'The daemon is running but is not attached to the macOS window server, so it cannot capture.',
        'Quit and reopen the Spectra menu-bar app from a logged-in desktop session so the daemon launches inside the GUI session.',
        true,
      )
    }
    const hint = body?.hint ?? defaultHint(code)
    return new DaemonError(code, message, hint, body?.retryable ?? false)
  }
}

function defaultHint(code: ApiErrorCode): string {
  switch (code) {
    case 'not_found':
      return 'Run spectra_session action="list" to see active sessions, or spectra_connect to start one.'
    case 'permission_denied':
      return 'Grant the required macOS permission (Accessibility / Screen Recording) in System Settings → Privacy & Security.'
    case 'capability_denied':
      return 'This caller is not authorized for that operation over the daemon socket.'
    case 'unsupported_api_version':
      return `This client speaks apiVersion ${API_VERSION}. Update the Spectra app and daemon to matching builds.`
    case 'capture_failed':
    case 'recording_failed':
      return 'Check that the target window is visible and on-screen, then retry.'
    case 'daemon_unhealthy':
      return 'Restart the Spectra menu-bar app so the daemon reattaches to the GUI session.'
    default:
      return 'Check the Spectra daemon logs for details.'
  }
}

/** Remove top-level `undefined` values (and return undefined for empty/nullish). */
function stripUndefined(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

export function timeoutForOperation(
  operation: CoreApiOperation,
  params: unknown,
  baseTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): number {
  if (operation !== 'recordComposite') return baseTimeoutMs

  const durationSeconds = recordCompositeDurationSeconds(params)
  return Math.max(
    baseTimeoutMs,
    Math.ceil(durationSeconds * 1000) + RECORD_COMPOSITE_TIMEOUT_BUFFER_MS,
  )
}

function recordCompositeDurationSeconds(params: unknown): number {
  const duration = (params as Partial<RecordCompositeParams> | undefined)?.durationSeconds
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
    ? duration
    : 5
}
