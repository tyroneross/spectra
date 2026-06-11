// ─── Platform ───────────────────────────────────────────────
export type Platform = 'web' | 'macos' | 'ios' | 'watchos' | 'terminal'
export type CaptureMode = 'full' | 'element' | 'region' | 'auto'
export type CapturePreset = 'docs' | 'demo' | 'social' | 'app-store'

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
  command?: string     // For terminal driver
}

export interface Driver {
  connect(target: DriverTarget): Promise<void>
  snapshot(): Promise<Snapshot>
  act(elementId: string, action: ActionType, value?: string): Promise<ActResult>
  screenshot(): Promise<Buffer>
  /** Navigate to a URL (optional — not all drivers support navigation). */
  navigate?(url: string): Promise<void>
  /** Expose internal connection for advanced CDP operations (optional). */
  getConnection?(): { conn: unknown; sessionId: string | null }
  /** End the current session (keep underlying infrastructure alive). */
  close(): Promise<void>
  /** Full teardown — closes underlying connections/processes. */
  disconnect(): Promise<void>
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
  closedAt?: number
  /**
   * Absolute path to the session's storage directory (`<repoStoragePath>/sessions/<id>`).
   * Populated when `connect` is called with a `repoPath` so the daemon (which
   * runs under launchd with CWD=$HOME) still writes artifacts under the repo.
   * When absent, callers fall back to the process-CWD-derived storage path.
   */
  storageRoot?: string
  /** Dev-server / app process spawned by the launcher when connect was given a repoPath. */
  launchedProcess?: {
    pid?: number
    kind: string
    killOnDisconnect: boolean
  }
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
  intent?: string
  decisionId?: string
}

// ─── Capture Run ─────────────────────────────────────────────
export type CaptureRunStatus = 'active' | 'closed' | 'failed'
export type CaptureRunPlannerSource = 'host-agent' | 'standalone-fallback' | 'manual' | 'unknown'
export type CaptureRunDecisionOutcome =
  | 'auto-executed'
  | 'needs-host-decision'
  | 'manual'
  | 'planned'
  | 'failed'
export type CaptureRunRecordingState =
  | 'idle'
  | 'arming'
  | 'recording'
  | 'encoding'
  | 'saved'
  | 'failed'
  | 'aborted'

export interface CaptureRunCandidate {
  id: string
  role: string
  label: string
  confidence?: number
}

export interface CaptureRunDecision {
  id: string
  timestamp: number
  tool: string
  plannerSource: CaptureRunPlannerSource
  intent?: string
  mode?: ResolveOptions['mode']
  confidence?: number
  outcome: CaptureRunDecisionOutcome
  selected?: CaptureRunCandidate
  candidates?: CaptureRunCandidate[]
  action?: Action
  actionReason?: string
  visionFallback?: boolean
  stepIndex?: number
  error?: string
}

export interface CaptureRunAction {
  stepIndex: number
  timestamp: number
  tool?: string
  plannerSource?: CaptureRunPlannerSource
  intent?: string
  action: Action
  snapshotBefore: string
  snapshotAfter: string
  screenshotPath: string
  success: boolean
  error?: string
  duration: number
  decisionId?: string
}

export interface CaptureRunArtifact {
  id: string
  type: 'screenshot' | 'video' | 'raw-video' | 'snapshot' | 'other'
  path: string
  format?: string
  label?: string
  createdAt: number
  stepIndex?: number
  sizeBytes?: number
  metadata?: Record<string, unknown>
}

export interface CaptureRunRecording {
  state: CaptureRunRecordingState
  recordingId?: string
  preset?: CapturePreset
  startedAt?: number
  stoppedAt?: number
  rawPath?: string
  path?: string
  durationMs?: number
  sizeBytes?: number
  codec?: string
  fps?: number
  width?: number
  height?: number
  bitrate?: string
  droppedFrames?: number
  error?: string
  source?: string
  sourceVerified?: boolean
}

export interface CaptureRunEvent {
  id: string
  timestamp: number
  type: string
  summary: string
  data?: Record<string, unknown>
}

export interface CaptureRunManifest {
  schemaVersion: 1
  runId: string
  sessionId: string
  name: string
  platform: Platform
  target: DriverTarget
  planner: {
    source: CaptureRunPlannerSource
    note?: string
  }
  status: CaptureRunStatus
  recording: CaptureRunRecording
  stats: {
    steps: number
    screenshots: number
    videos: number
    errors: number
  }
  decisions: CaptureRunDecision[]
  actions: CaptureRunAction[]
  artifacts: CaptureRunArtifact[]
  events: CaptureRunEvent[]
  createdAt: number
  updatedAt: number
  closedAt?: number
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
  visionFallback?: boolean
}
