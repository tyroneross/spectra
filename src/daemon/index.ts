export { createCoreApi } from './core-impl.js'
export { createDaemonCore } from './core.js'
export type { CoreApiImplementationOptions } from './core-impl.js'
export type { DaemonCoreOptions } from './core.js'

export { startDaemonServer, createDaemonRequestHandler } from './server.js'
export type {
  DaemonRequestHandler,
  DaemonServerOptions,
  DaemonTcpOptions,
  DaemonUnixOptions,
  RunningDaemonServer,
} from './server.js'

export {
  CapabilityDeniedError,
  assertCallerCanInvoke,
  authorizeBearerHeader,
  callerCanInvoke,
  isAllowedOrigin,
  isLoopbackHost,
  missingCapabilitiesForOperation,
  normalizeHostHeader,
  requiredCapabilitiesForOperation,
  verifyLoopbackRequest,
} from './security.js'
export type { LoopbackRequestHeaders, LoopbackRequestVerification } from './security.js'

export {
  apiErrorBody,
  errorEnvelope,
  eventEnvelope,
  formatSseFrame,
  makeRequestId,
  sseFrame,
  successEnvelope,
  unsupportedApiVersionEnvelope,
} from './envelope.js'
export type { EnvelopeOptions } from './envelope.js'
