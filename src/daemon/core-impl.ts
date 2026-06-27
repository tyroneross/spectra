import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type {
  AnalyzeParams,
  AnalyzeResult,
  AutoRampDemoParams,
  AutoRampDemoResult,
  CloseAllSessionsResult,
  CloseSessionResult,
  CoreApi,
  CreateSessionParams,
  CreateSessionResult,
  DemoParams,
  DemoResult,
  DiscoverParams,
  DiscoverResult,
  GetPermissionsParams,
  GetRunResult,
  GetSessionResult,
  HealthParams,
  HealthResult,
  LibraryParams,
  LibraryResult,
  ListSessionsParams,
  ListSessionsResult,
  ListWindowsParams,
  ListWindowsResult,
  PermissionKind,
  PermissionState,
  PermissionStatus,
  RecordCompositeParams,
  RecordCompositeResult,
  RecordLlmUsageParams,
  RecordLlmUsageResult,
  RequestPermissionsParams,
  RequestPermissionsResult,
  ScreenshotParams,
  ScreenshotResult,
  SessionByIdParams,
  StartRecordingParams,
  StartRecordingResult,
  StopRecordingParams,
  StopRecordingResult,
  WindowRecord,
  SnapshotParams,
  SnapshotResult,
  ObserveParams,
  ObserveResult,
  ActParams,
  ActResult,
  StepParams,
  StepResult,
  LlmStepParams,
  LlmStepResult,
  WalkthroughParams,
  WalkthroughResult,
  JsonValue,
  TerminalRecordParams,
  TerminalRecordResult,
  TerminalReplayParams,
  TerminalReplayResult,
} from '../contract/core-api.js'
import { createContext, type ToolContext } from '../mcp/context.js'
import { handleAnalyze } from '../mcp/tools/analyze.js'
import { handleAct } from '../mcp/tools/act.js'
import { handleCapture } from '../mcp/tools/capture.js'
import { handleConnect } from '../mcp/tools/connect.js'
import { handleDemo } from '../mcp/tools/demo.js'
import { handleDiscover } from '../mcp/tools/discover.js'
import { handleLibrary } from '../mcp/tools/library.js'
import { handleLlmStep } from '../mcp/tools/llm-step.js'
import { handleRecord, handleReplay } from '../mcp/tools/record.js'
import { handleSession } from '../mcp/tools/session.js'
import { handleSnapshot } from '../mcp/tools/snapshot.js'
import { handleStep } from '../mcp/tools/step.js'
import { handleWalkthrough } from '../mcp/tools/walkthrough.js'
import { ensureCompositeBinary } from '../native/compiler.js'
import { recordCompositeWithWorker } from './composite-worker.js'
import { DaemonApiError } from './errors.js'
import { health as daemonHealth, type HealthProbeOptions } from './health.js'
import type { KeepAwakeController } from './keep-awake.js'
import { createKeepAwakeController } from './keep-awake.js'

const execFileAsync = promisify(execFile)

const SINGLE_WINDOW_RECORDING_HINT =
  'Use recordComposite(params) for daemon-owned window-isolated ScreenCaptureKit capture. '
  + 'startRecording/stopRecording are intentionally not wired to the legacy full-display '
  + 'AVFoundation path; they need a separate frozen single-window streaming contract.'

type CompositeWorker = typeof recordCompositeWithWorker
let screenCaptureKitWindowList: Promise<WindowRecord[]> | undefined

export interface CoreApiImplementationOptions {
  context?: ToolContext
  startedAt?: number
  daemonVersion?: string
  healthProbe?: HealthProbeOptions
  keepAwake?: KeepAwakeController
  recordCompositeWorker?: CompositeWorker
}

export function createCoreApi(options: CoreApiImplementationOptions = {}): CoreApi {
  return new CoreApiImplementation(options)
}

class CoreApiImplementation implements CoreApi {
  private readonly ctx: ToolContext
  private readonly startedAt: number
  private readonly daemonVersion?: string
  private readonly healthProbe?: HealthProbeOptions
  private readonly keepAwake: KeepAwakeController
  private readonly recordCompositeWorker: CompositeWorker

  constructor(options: CoreApiImplementationOptions) {
    this.ctx = options.context ?? createContext()
    this.startedAt = options.startedAt ?? Date.now()
    this.daemonVersion = options.daemonVersion
    this.healthProbe = options.healthProbe
    this.keepAwake = options.keepAwake ?? createKeepAwakeController()
    this.recordCompositeWorker = options.recordCompositeWorker ?? recordCompositeWithWorker
  }

  async health(params: HealthParams = {}): Promise<HealthResult> {
    return daemonHealth(params, {
      ...this.healthProbe,
      startedAt: this.startedAt,
      daemonVersion: this.daemonVersion,
      permissionsProvider: () => this.getPermissions({}).then((r) => r.permissions),
    })
  }

  async getPermissions(params: GetPermissionsParams = {}): Promise<{ permissions: PermissionStatus[] }> {
    return { permissions: await getPermissionStatuses(params.permissions) }
  }

  async requestPermissions(params: RequestPermissionsParams): Promise<RequestPermissionsResult> {
    if (params.openSettings && process.platform === 'darwin') {
      await openPermissionSettings(params.permissions).catch(() => {})
    }
    const result = await this.getPermissions({ permissions: params.permissions })
    return { ...result, requested: params.permissions }
  }

  async listWindows(params: ListWindowsParams = {}): Promise<ListWindowsResult> {
    const windows = await listMacWindows()
    const app = params.app?.toLowerCase()
    const title = params.title?.toLowerCase()
    return {
      windows: windows.filter((window) => {
        if (params.onScreenOnly !== false && !window.onScreen) return false
        if (app) {
          const appName = window.appName.toLowerCase()
          const bundle = window.bundleIdentifier?.toLowerCase() ?? ''
          if (!appName.includes(app) && !bundle.includes(app)) return false
        }
        if (title && !window.title.toLowerCase().includes(title)) return false
        return true
      }),
    }
  }

  async createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    return handleConnect(params, this.ctx) as Promise<CreateSessionResult>
  }

  async listSessions(_params: ListSessionsParams = {}): Promise<ListSessionsResult> {
    return {
      sessions: this.ctx.sessions.list().map((session) => ({
        id: session.id,
        name: session.name,
        platform: session.platform,
        steps: session.steps.length,
        recordingState: this.ctx.sessions.getRun(session.id)?.recording.state ?? 'idle',
        createdAt: new Date(session.createdAt).toISOString(),
      })),
    }
  }

  async getSession(params: SessionByIdParams): Promise<GetSessionResult> {
    const session = this.ctx.sessions.get(params.sessionId)
    if (!session) throw new DaemonApiError('not_found', `Session ${params.sessionId} not found`, { status: 404 })
    return {
      session,
      run: this.ctx.sessions.getRun(params.sessionId) as unknown as GetSessionResult['run'],
    }
  }

  async getRun(params: SessionByIdParams): Promise<GetRunResult> {
    const run = this.ctx.sessions.getRun(params.sessionId)
    if (!run) throw new DaemonApiError('not_found', `Run for session ${params.sessionId} not found`, { status: 404 })
    return { run: run as unknown as GetRunResult['run'] }
  }

  async closeSession(params: SessionByIdParams): Promise<CloseSessionResult> {
    return handleSession({ action: 'close', sessionId: params.sessionId }, this.ctx) as Promise<CloseSessionResult>
  }

  async closeAllSessions(): Promise<CloseAllSessionsResult> {
    return handleSession({ action: 'close_all' }, this.ctx) as Promise<CloseAllSessionsResult>
  }

  async recordLlmUsage(params: RecordLlmUsageParams): Promise<RecordLlmUsageResult> {
    return handleSession(
      { action: 'record_llm_usage', sessionId: params.sessionId, usage: params.usage },
      this.ctx,
    ) as Promise<RecordLlmUsageResult>
  }

  async snapshot(params: SnapshotParams): Promise<SnapshotResult> {
    return handleSnapshot(params, this.ctx)
  }

  async observe(params: ObserveParams): Promise<ObserveResult> {
    const snapshot = await this.snapshot(params)
    const session = this.ctx.sessions.get(params.sessionId)
    const run = this.ctx.sessions.getRun(params.sessionId)
    return {
      ...snapshot,
      sessionId: params.sessionId,
      platform: session?.platform,
      recording: run?.recording,
      analysis: params.analyze ? await this.analyze(params) : undefined,
    }
  }

  async act(params: ActParams): Promise<ActResult> {
    return handleAct(params, this.ctx)
  }

  async step(params: StepParams): Promise<StepResult> {
    return handleStep(params, this.ctx)
  }

  async llmStep(params: LlmStepParams): Promise<LlmStepResult> {
    return handleLlmStep(params, this.ctx)
  }

  async walkthrough(params: WalkthroughParams): Promise<WalkthroughResult> {
    return handleWalkthrough(params, this.ctx)
  }

  async screenshot(params: ScreenshotParams): Promise<ScreenshotResult> {
    return handleCapture({ ...params, type: 'screenshot' }, this.ctx) as Promise<ScreenshotResult>
  }

  async startRecording(_params: StartRecordingParams): Promise<StartRecordingResult> {
    throw new DaemonApiError(
      'recording_failed',
      'startRecording is not available on the daemon until single-window recording is wired.',
      { status: 501, hint: SINGLE_WINDOW_RECORDING_HINT, retryable: false },
    )
  }

  async stopRecording(_params: StopRecordingParams): Promise<StopRecordingResult> {
    throw new DaemonApiError(
      'recording_failed',
      'stopRecording is not available on the daemon until single-window recording is wired.',
      { status: 501, hint: SINGLE_WINDOW_RECORDING_HINT, retryable: false },
    )
  }

  async recordComposite(params: RecordCompositeParams): Promise<RecordCompositeResult> {
    const recordingId = `composite-${randomUUID().slice(0, 8)}`
    await this.keepAwake.recordingStarted(recordingId)
    try {
      const result = await this.recordCompositeWorker(params)
      const artifactId = result.ok && result.output
        ? await this.addCompositeArtifact(params, result, recordingId)
        : undefined
      return artifactId ? { ...result, artifactId } : result
    } catch (error) {
      throw new DaemonApiError(
        'recording_failed',
        `recordComposite failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          status: 500,
          hint: 'Verify the daemon is running in a GUI/Aqua session with Screen Recording permission, target windows are visible, ffmpeg is installed, and the Swift composite worker builds.',
          retryable: false,
          cause: error,
        },
      )
    } finally {
      await this.keepAwake.recordingStopped(recordingId).catch(() => {})
    }
  }

  async analyze(params: AnalyzeParams): Promise<AnalyzeResult> {
    return handleAnalyze(params, this.ctx)
  }

  async discover(params: DiscoverParams): Promise<DiscoverResult> {
    return handleDiscover(params, this.ctx)
  }

  async recordTerminal(params: TerminalRecordParams): Promise<TerminalRecordResult> {
    return handleRecord(params)
  }

  async replayTerminal(params: TerminalReplayParams): Promise<TerminalReplayResult> {
    return handleReplay(params)
  }

  async library(params: LibraryParams): Promise<LibraryResult> {
    return handleLibrary(params as Parameters<typeof handleLibrary>[0]) as Promise<LibraryResult>
  }

  async demo(params: DemoParams): Promise<DemoResult> {
    if (params.action === 'record-composite') {
      const { action: _action, ...recordParams } = params
      return this.recordComposite(recordParams)
    }
    return handleDemo(params, this.ctx) as Promise<DemoResult>
  }

  async autoRampDemo(params: AutoRampDemoParams): Promise<AutoRampDemoResult> {
    return handleDemo({ ...params, action: 'auto-ramp' }, this.ctx) as Promise<AutoRampDemoResult>
  }

  async close(): Promise<void> {
    await this.keepAwake.close()
  }

  private async addCompositeArtifact(
    params: RecordCompositeParams,
    result: RecordCompositeResult,
    recordingId: string,
  ): Promise<string | undefined> {
    if (!params.sessionId || !this.ctx.sessions.get(params.sessionId)) return undefined
    const metadata: Record<string, JsonValue> = {
      recordingId,
      appA: params.appA,
      appB: params.appB,
      blackFrameMeanLuma: result.blackFrameGuard.meanLuma,
      blackFrameAllBlack: result.blackFrameGuard.allBlack,
      blackFrameSampleCount: result.blackFrameGuard.sampleCount,
      warnings: result.warnings,
    }
    if (params.durationSeconds !== undefined) metadata.durationSeconds = params.durationSeconds
    if (params.fps !== undefined) metadata.fps = params.fps
    const artifact = await this.ctx.sessions.addArtifact(params.sessionId, {
      type: 'video',
      path: result.output!,
      format: 'mp4',
      label: 'Composite recording',
      metadata,
    })
    return artifact.id
  }
}

async function getPermissionStatuses(filter?: PermissionKind[]): Promise<PermissionStatus[]> {
  const permissions: PermissionKind[] = filter ?? [
    'accessibility',
    'screen-recording',
    'automation',
    'developer-tools',
  ]
  const now = Date.now()
  const states = await Promise.all(permissions.map(async (permission) => {
    const state = await probePermission(permission)
    return permissionStatus(permission, state, now)
  }))
  return states
}

async function probePermission(permission: PermissionKind): Promise<PermissionState> {
  if (process.platform !== 'darwin') return 'unsupported'
  if (permission === 'accessibility') {
    try {
      const { stdout } = await execFileAsync('/usr/bin/osascript', [
        '-e',
        'tell application "System Events" to get UI elements enabled',
      ], { timeout: 1_000 })
      return stdout.trim().toLowerCase() === 'true' ? 'granted' : 'denied'
    } catch {
      return 'unknown'
    }
  }
  return 'unknown'
}

function permissionStatus(
  permission: PermissionKind,
  state: PermissionState,
  lastCheckedAt: number,
): PermissionStatus {
  const requiredFor: Record<PermissionKind, string[]> = {
    accessibility: ['macOS UI snapshots', 'macOS UI actions'],
    'screen-recording': ['screenshots', 'video capture'],
    automation: ['opening System Settings', 'controlling helper applications'],
    'developer-tools': ['web CDP debugging'],
  }
  return {
    permission,
    state,
    requiredFor: requiredFor[permission],
    canPrompt: process.platform === 'darwin',
    settingsUrl: process.platform === 'darwin' ? settingsUrl(permission) : undefined,
    lastCheckedAt,
  }
}

function settingsUrl(permission: PermissionKind): string | undefined {
  switch (permission) {
    case 'accessibility':
      return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    case 'screen-recording':
      return 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    case 'automation':
      return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'
    case 'developer-tools':
      return 'x-apple.systempreferences:com.apple.preference.security?Privacy_DeveloperTools'
  }
}

async function openPermissionSettings(permissions: PermissionKind[]): Promise<void> {
  const url = settingsUrl(permissions[0])
  if (url) await execFileAsync('/usr/bin/open', [url], { timeout: 1_000 })
}

async function listMacWindows(): Promise<WindowRecord[]> {
  if (process.platform !== 'darwin') return []
  const sckWindows = await listScreenCaptureKitWindowsSerial().catch(() => [])
  if (sckWindows.length > 0) return sckWindows
  return listAccessibilityWindows().catch(() => [])
}

async function listScreenCaptureKitWindowsSerial(): Promise<WindowRecord[]> {
  if (screenCaptureKitWindowList) return screenCaptureKitWindowList
  const pending = listScreenCaptureKitWindows()
  screenCaptureKitWindowList = pending
  try {
    return await pending
  } finally {
    if (screenCaptureKitWindowList === pending) screenCaptureKitWindowList = undefined
  }
}

async function listScreenCaptureKitWindows(): Promise<WindowRecord[]> {
  const binary = ensureCompositeBinary()
  const { stdout } = await execFileAsync(binary, ['--list-windows'], {
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  return parseScreenCaptureKitWindows(stdout)
}

function parseScreenCaptureKitWindows(stdout: string): WindowRecord[] {
  const parsed = JSON.parse(stdout) as { windows?: unknown }
  if (!Array.isArray(parsed.windows)) return []
  return parsed.windows.flatMap((entry): WindowRecord[] => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const windowId = numberValue(record.windowId)
    const processId = numberValue(record.processId)
    const x = numberValue(record.x)
    const y = numberValue(record.y)
    const width = numberValue(record.width)
    const height = numberValue(record.height)
    const layer = numberValue(record.layer)
    if (
      windowId === undefined
      || processId === undefined
      || x === undefined
      || y === undefined
      || width === undefined
      || height === undefined
      || layer === undefined
    ) {
      return []
    }
    return [{
      windowId,
      appName: stringValue(record.appName),
      bundleIdentifier: optionalStringValue(record.bundleIdentifier),
      processId,
      title: stringValue(record.title),
      x,
      y,
      width,
      height,
      onScreen: booleanValue(record.onScreen, true),
      active: optionalBooleanValue(record.active),
      layer,
    }]
  })
}

async function listAccessibilityWindows(): Promise<WindowRecord[]> {
  const script = `
set output to ""
tell application "System Events"
  repeat with p in (application processes whose background only is false)
    set appName to name of p
    set appPid to unix id of p
    set bundleId to ""
    try
      set bundleId to bundle identifier of p
    end try
    repeat with w in windows of p
      try
        set windowTitle to name of w
        set windowPosition to position of w
        set windowSize to size of w
        set output to output & appPid & tab & appName & tab & bundleId & tab & windowTitle & tab & item 1 of windowPosition & tab & item 2 of windowPosition & tab & item 1 of windowSize & tab & item 2 of windowSize & linefeed
      end try
    end repeat
  end repeat
end tell
return output
`
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  })
  return stdout.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const [pid, appName, bundleIdentifier, title, x, y, width, height] = line.split('\t')
    return {
      windowId: index + 1,
      appName: appName ?? '',
      bundleIdentifier: bundleIdentifier || undefined,
      processId: Number.parseInt(pid ?? '0', 10) || 0,
      title: title ?? '',
      x: Number.parseFloat(x ?? '0') || 0,
      y: Number.parseFloat(y ?? '0') || 0,
      width: Number.parseFloat(width ?? '0') || 0,
      height: Number.parseFloat(height ?? '0') || 0,
      onScreen: true,
      active: null,
      layer: 0,
    }
  })
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function optionalBooleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}
