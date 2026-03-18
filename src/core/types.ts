// ─── Platform ───────────────────────────────────────────────
export type Platform = 'web' | 'macos' | 'ios' | 'watchos'

// ─── Elements ───────────────────────────────────────────────
export interface Element {
  id: string
  role: string
  label: string
  value: string | null
  enabled: boolean
  focused: boolean
  actions: string[]
  bounds: [number, number, number, number]
  parent: string | null
}

// ─── Snapshots ──────────────────────────────────────────────
export interface Snapshot {
  url?: string
  appName?: string
  platform: Platform
  elements: Element[]
  timestamp: number
  metadata?: SnapshotMetadata
}

export interface SnapshotMetadata {
  elementCount: number
  stableAt?: number
  timedOut?: boolean
}

// ─── Actions ────────────────────────────────────────────────
export type ActionType = 'click' | 'type' | 'clear' | 'select' | 'scroll' | 'hover' | 'focus'

export interface Action {
  type: ActionType
  elementId: string
  value?: string
}

export interface ActResult {
  success: boolean
  error?: string
  snapshot: Snapshot
}

// ─── Driver ─────────────────────────────────────────────────
export interface DriverTarget {
  url?: string
  appName?: string
  deviceId?: string
}

export interface Driver {
  connect(target: DriverTarget): Promise<void>
  snapshot(): Promise<Snapshot>
  act(elementId: string, action: ActionType, value?: string): Promise<ActResult>
  screenshot(): Promise<Buffer>
  close(): Promise<void>
}

// ─── Session ────────────────────────────────────────────────
export interface Session {
  id: string
  name: string
  platform: Platform
  target: DriverTarget
  steps: Step[]
  createdAt: number
  updatedAt: number
}

export interface Step {
  index: number
  action: Action
  snapshotBefore: string
  snapshotAfter: string
  screenshotPath: string
  success: boolean
  error?: string
  timestamp: number
  duration: number
}

// ─── Resolution ─────────────────────────────────────────────
export interface ResolveOptions {
  intent: string
  elements: Element[]
  mode: 'claude' | 'algorithmic'
}

export interface ResolveResult {
  element: Element
  confidence: number
  candidates?: Element[]
}
