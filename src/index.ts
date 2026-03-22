// ─── Core types ─────────────────────────────────────────────
export type {
  Platform,
  Element,
  Snapshot,
  SnapshotMetadata,
  Action,
  ActionType,
  ActResult,
  Driver,
  DriverTarget,
  Session,
  Step,
  ResolveOptions,
  ResolveResult,
} from './core/types.js'

// ─── Session management ─────────────────────────────────────
export { SessionManager } from './core/session.js'
export type { CreateSessionOptions, AddStepOptions } from './core/session.js'

// ─── Storage ────────────────────────────────────────────────
export { getStoragePath, findProjectRoot } from './core/storage.js'

// ─── Resolution ─────────────────────────────────────────────
export { resolve } from './core/resolve.js'

// ─── Drivers ────────────────────────────────────────────────
export { CdpDriver } from './cdp/driver.js'
export type { CdpDriverOptions } from './cdp/driver.js'
export { NativeDriver } from './native/driver.js'
export { SimDriver } from './native/sim.js'

// ─── Utilities ──────────────────────────────────────────────
export { normalizeRole } from './core/normalize.js'
export { serializeSnapshot, serializeElement } from './core/serialize.js'
