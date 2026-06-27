import { randomBytes, createHash } from 'node:crypto'
import { mkdir, lstat, readFile, unlink, writeFile, chmod } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { tokenMatches } from '../cli/token.js'
import {
  loopbackHttpTransportPolicy,
  operationCapabilities,
  primarySocketMode,
  type ApiErrorBody,
  type Capability,
  type ClientSurface,
  type CoreApiOperation,
  type LoopbackHttpTransportPolicy,
  type VerifiedCaller,
} from '../contract/wire.js'
import { DaemonApiError } from './errors.js'

export type UnixPeerCredentials = {
  uid?: number
  gid?: number
  pid?: number
}

export type UnixPeerCredentialResolver = (socket: Socket) => UnixPeerCredentials | Promise<UnixPeerCredentials>

export const allCapabilities = Array.from(
  new Set(Object.values(operationCapabilities).flat()),
) as Capability[]

export function normalizeHostHeader(hostHeader: string | null | undefined): string | null {
  const value = hostHeader?.trim().toLowerCase()
  if (!value) return null

  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    return close > 1 ? value.slice(1, close) : value
  }

  const colon = value.lastIndexOf(':')
  const hasSingleColon = colon >= 0 && value.indexOf(':') === colon
  const host = hasSingleColon ? value.slice(0, colon) : value
  return host.endsWith('.') ? host.slice(0, -1) : host
}

export function isLoopbackHost(
  hostHeader: string | null | undefined,
  allowedHosts: readonly string[] = loopbackHttpTransportPolicy.allowedHosts,
): boolean {
  const host = normalizeHostHeader(hostHeader)
  return Boolean(host && allowedHosts.includes(host))
}

export function isAllowedOrigin(
  originHeader: string | null | undefined,
  policy: LoopbackHttpTransportPolicy = loopbackHttpTransportPolicy,
): boolean {
  if (!policy.origin.validate) return true

  const value = originHeader?.trim()
  if (!value) {
    return true
  }

  if (policy.origin.allowedOrigins.includes(value)) {
    return true
  }

  try {
    const origin = new URL(value)
    return isLoopbackHost(origin.host, policy.allowedHosts)
  } catch {
    return false
  }
}

export function authorizeBearerHeader(
  authorizationHeader: string | null | undefined,
  token: string,
): boolean {
  return tokenMatches(authorizationHeader ?? undefined, token)
}

export function requiredCapabilitiesForOperation<T extends CoreApiOperation>(
  operation: T,
): readonly Capability[] {
  return operationCapabilities[operation]
}

export function missingCapabilitiesForOperation(
  caller: Pick<VerifiedCaller, 'capabilities'>,
  operation: CoreApiOperation,
): Capability[] {
  const granted = new Set(caller.capabilities)
  return requiredCapabilitiesForOperation(operation).filter((capability) => !granted.has(capability))
}

export function callerCanInvoke(
  caller: Pick<VerifiedCaller, 'capabilities'>,
  operation: CoreApiOperation,
): boolean {
  return missingCapabilitiesForOperation(caller, operation).length === 0
}

export class CapabilityDeniedError extends Error {
  readonly operation: CoreApiOperation
  readonly missingCapabilities: Capability[]

  constructor(operation: CoreApiOperation, missingCapabilities: Capability[]) {
    super(`Caller lacks capabilities for ${operation}: ${missingCapabilities.join(', ')}`)
    this.name = 'CapabilityDeniedError'
    this.operation = operation
    this.missingCapabilities = missingCapabilities
  }
}

export function assertCallerCanInvoke(
  caller: Pick<VerifiedCaller, 'capabilities'>,
  operation: CoreApiOperation,
): void {
  const missing = missingCapabilitiesForOperation(caller, operation)
  if (missing.length > 0) {
    throw new CapabilityDeniedError(operation, missing)
  }
}

export function isCoreApiOperation(value: string): value is CoreApiOperation {
  return Object.hasOwn(operationCapabilities, value)
}

export function assertCapabilities(
  caller: Pick<VerifiedCaller, 'capabilities'>,
  required: readonly Capability[],
): void {
  const granted = new Set(caller.capabilities)
  const missing = required.filter((capability) => !granted.has(capability))
  if (missing.length === 0) return

  throw new DaemonApiError('capability_denied', `Caller lacks capabilities: ${missing.join(', ')}`, {
    status: 403,
    details: { missing },
    retryable: false,
  })
}

export function assertOperationAllowed(
  operation: CoreApiOperation,
  caller: Pick<VerifiedCaller, 'capabilities'>,
): void {
  assertCapabilities(caller, requiredCapabilitiesForOperation(operation))
}

export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

export async function prepareUnixSocketPath(socketPath: string): Promise<void> {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 })
  try {
    const stat = await lstat(socketPath)
    if (stat.isSocket()) {
      await unlink(socketPath)
      return
    }
    throw new DaemonApiError('conflict', `Refusing to replace non-socket path: ${socketPath}`, {
      status: 409,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    if (error instanceof DaemonApiError) throw error
    throw error
  }
}

export interface BearerTokenInfo {
  token: string
  tokenId: string
  path: string
  created: boolean
}

export async function getOrCreateBearerToken(
  tokenPath: string,
  tokenOverride?: string,
): Promise<BearerTokenInfo> {
  const path = expandHomePath(tokenPath)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })

  if (tokenOverride) {
    await writeFile(path, `${tokenOverride}\n`, { mode: 0o600 })
    await chmod(path, 0o600).catch(() => {})
    return {
      token: tokenOverride,
      tokenId: tokenId(tokenOverride),
      path,
      created: true,
    }
  }

  try {
    const existing = (await readFile(path, 'utf8')).trim()
    if (existing) {
      await chmod(path, 0o600).catch(() => {})
      return {
        token: existing,
        tokenId: tokenId(existing),
        path,
        created: false,
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const token = randomBytes(32).toString('base64url')
  await writeFile(path, `${token}\n`, { mode: 0o600 })
  await chmod(path, 0o600).catch(() => {})
  return {
    token,
    tokenId: tokenId(token),
    path,
    created: true,
  }
}

export function assertLoopbackTcpRequest(
  req: IncomingMessage,
  allowedOrigins: string[] = [],
): void {
  const host = headerValue(req.headers.host)
  const origin = headerValue(req.headers.origin)
  const remoteAddress = req.socket.remoteAddress

  if (!isLoopbackHost(host) || (remoteAddress && !isLoopbackAddress(remoteAddress))) {
    throw new DaemonApiError('forbidden', 'Loopback TCP daemon access requires a loopback Host and socket.', {
      status: 403,
    })
  }

  if (!origin || !allowedOrigins.includes(origin)) {
    throw new DaemonApiError('forbidden', 'Origin is not allowed for loopback TCP daemon access.', {
      status: 403,
    })
  }
}

export function verifyBearerCaller(options: {
  req: IncomingMessage
  token: string
  tokenId?: string
  surface: ClientSurface
  capabilities: readonly Capability[]
}): VerifiedCaller {
  const authorization = headerValue(options.req.headers.authorization)
  if (!authorizeBearerHeader(authorization, options.token)) {
    throw new DaemonApiError('unauthorized', 'Valid bearer token is required.', { status: 401 })
  }

  return {
    surface: options.surface,
    verifiedBy: 'bearer-token',
    capabilities: [...options.capabilities],
    tokenId: options.tokenId,
  }
}

export async function verifyUnixCaller(options: {
  socket: Socket
  socketPath: string
  surface: ClientSurface
  capabilities: readonly Capability[]
  peerCredentials?: UnixPeerCredentialResolver
  enforceSocketMode?: boolean
}): Promise<VerifiedCaller> {
  if (options.enforceSocketMode !== false) {
    await assertSocketIsPrivate(options.socketPath)
  }

  const credentials = await (
    options.peerCredentials?.(options.socket)
    ?? defaultUnixPeerCredentials()
  )

  return {
    surface: options.surface,
    verifiedBy: 'unix-peer',
    capabilities: [...options.capabilities],
    uid: credentials.uid,
    gid: credentials.gid,
    pid: credentials.pid,
  }
}

export interface LoopbackRequestHeaders {
  host?: string | null
  origin?: string | null
  authorization?: string | null
}

export type LoopbackRequestVerification =
  | { ok: true; caller: VerifiedCaller }
  | { ok: false; status: 401 | 403; error: ApiErrorBody }

export function verifyLoopbackRequest(
  headers: LoopbackRequestHeaders,
  token: string,
  options: {
    capabilities?: readonly Capability[]
    policy?: LoopbackHttpTransportPolicy
    surface?: ClientSurface
    tokenId?: string
  } = {},
): LoopbackRequestVerification {
  const policy = options.policy ?? loopbackHttpTransportPolicy

  if (policy.rejectNonLoopbackHost && !isLoopbackHost(headers.host, policy.allowedHosts)) {
    return {
      ok: false,
      status: 403,
      error: {
        code: 'forbidden',
        message: 'Host is not allowed for loopback HTTP daemon access.',
      },
    }
  }

  if (!isAllowedOrigin(headers.origin, policy)) {
    return {
      ok: false,
      status: 403,
      error: {
        code: 'forbidden',
        message: 'Origin is not allowed for loopback HTTP daemon access.',
      },
    }
  }

  if (policy.bearer.required && !authorizeBearerHeader(headers.authorization, token)) {
    return {
      ok: false,
      status: 401,
      error: {
        code: 'unauthorized',
        message: 'Valid bearer token is required.',
      },
    }
  }

  return {
    ok: true,
    caller: {
      surface: options.surface ?? 'unknown',
      verifiedBy: 'bearer-token',
      capabilities: [...(options.capabilities ?? [])],
      tokenId: options.tokenId,
    },
  }
}

async function assertSocketIsPrivate(socketPath: string): Promise<void> {
  const stat = await lstat(socketPath)
  const mode = stat.mode & 0o777
  if (mode !== 0o600) {
    throw new DaemonApiError('forbidden', `Unix socket mode must be ${primarySocketMode}: ${socketPath}`, {
      status: 403,
      details: { mode: mode.toString(8) },
    })
  }
}

function defaultUnixPeerCredentials(): UnixPeerCredentials {
  return {
    uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
    gid: typeof process.getgid === 'function' ? process.getgid() : undefined,
    pid: undefined,
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isLoopbackAddress(value: string): boolean {
  return value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1'
    || value === 'localhost'
}

function tokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}
