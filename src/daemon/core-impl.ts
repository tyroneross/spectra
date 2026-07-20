import { execFile, spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { promisify } from 'node:util'
import type {
  AnalyzeParams,
  AnalyzeResult,
  AutoRampDemoParams,
  AutoRampDemoResult,
  CaptureRunArtifact,
  CaptureRunRecording,
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
  BlackFrameGuard,
  PermissionKind,
  PermissionState,
  PermissionStaleness,
  PermissionStatus,
  GetRecordingParams,
  GetRecordingResult,
  RecordCompositeParams,
  RecordCompositeAcceptedResult,
  RecordCompositeCompletedResult,
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
  RecordingStatus,
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
  JsonObject,
  JsonValue,
  TerminalRecordParams,
  TerminalRecordResult,
  TerminalReplayParams,
  TerminalReplayResult,
  ComputerUseParams,
  ComputerUseResult,
} from '../contract/core-api.js'
import { ComputerUse } from '../computer-use/computer-use.js'
import { NativeAxBridgePort } from '../computer-use/native-port.js'
import { AxPermissionError } from '../computer-use/port.js'
import type { AxBridgePort } from '../computer-use/port.js'
import { NativeVisionFallback } from '../computer-use/vision-fallback.js'
import type { VisionFallback } from '../computer-use/vision-fallback.js'
import type { AxTarget } from '../computer-use/types.js'
import type { DaemonEvent } from '../contract/wire.js'
import { detectFfmpeg } from '../media/ffmpeg.js'
import { probeVideo } from '../media/pipeline.js'
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
import {
  ensureBinary,
  ensureCompositeBinary,
  ensureScreenRecordingPreflightBinary,
  ensureCursorSamplerBinary,
  SCREEN_RECORDING_PREFLIGHT_PATH,
  DAEMON_LAUNCHER_PATH,
} from '../native/compiler.js'
import { assessGrantStaleness, clearRegrantMarker, recordGrant } from '../native/signing.js'
import {
  COMPOSITE_WORKER_DEFAULTS,
  parseLuminance,
  recordCompositeWithWorker,
} from './composite-worker.js'
import { DaemonApiError } from './errors.js'
import { health as daemonHealth, type HealthProbeOptions } from './health.js'
import type { KeepAwakeController } from './keep-awake.js'
import { createKeepAwakeController } from './keep-awake.js'

const execFileAsync = promisify(execFile)

type CompositeWorker = typeof recordCompositeWithWorker
type SingleWindowRecordingRunner = (input: NativeStartRecordingInput) => Promise<NativeRecordingHandle>
type DaemonEventSink = (event: DaemonEvent) => void
let screenCaptureKitWindowList: Promise<WindowRecord[]> | undefined

export interface CoreApiImplementationOptions {
  context?: ToolContext
  startedAt?: number
  daemonVersion?: string
  healthProbe?: HealthProbeOptions
  keepAwake?: KeepAwakeController
  recordCompositeWorker?: CompositeWorker
  singleWindowRecordingRunner?: SingleWindowRecordingRunner
  windowListProvider?: () => Promise<WindowRecord[]>
  eventSink?: DaemonEventSink
}

export function createCoreApi(options: CoreApiImplementationOptions = {}): CoreApi {
  return new CoreApiImplementation(options)
}

export class CoreApiImplementation implements CoreApi {
  private readonly ctx: ToolContext
  private readonly startedAt: number
  private readonly daemonVersion?: string
  private readonly healthProbe?: HealthProbeOptions
  private readonly keepAwake: KeepAwakeController
  private readonly recordCompositeWorker: CompositeWorker
  private readonly singleWindowRecordingRunner: SingleWindowRecordingRunner
  private readonly windowListProvider: () => Promise<WindowRecord[]>
  private readonly eventSink?: DaemonEventSink
  private readonly recordings = new RecordingRegistry()
  private readonly compositeRecordings = new CompositeRecordingRegistry()
  /**
   * One ComputerUse instance per distinct target, reused across MCP calls so
   * its snapshot cache (and the native AX bridge it holds) actually pays off.
   * Previously computerUse() built a fresh ComputerUse per call, so `act`'s
   * cache was always empty and every standalone act fell through to
   * needsVisionFallback regardless of the app (see docs/prd — dead act path).
   * Keyed by target (pid/app) since a snapshot cache scoped to one window is
   * meaningless for another; targets are few and long-lived per session so
   * this map does not grow unbounded in practice.
   */
  private readonly computerUseInstances = new Map<string, ComputerUse>()

  constructor(options: CoreApiImplementationOptions = {}) {
    this.ctx = options.context ?? createContext()
    this.startedAt = options.startedAt ?? Date.now()
    this.daemonVersion = options.daemonVersion
    this.healthProbe = options.healthProbe
    this.keepAwake = options.keepAwake ?? createKeepAwakeController()
    this.recordCompositeWorker = options.recordCompositeWorker ?? recordCompositeWithWorker
    this.singleWindowRecordingRunner = options.singleWindowRecordingRunner ?? startNativeSingleWindowRecording
    this.windowListProvider = options.windowListProvider ?? listMacWindows
    this.eventSink = options.eventSink
  }

  protected spawnCursorSampler(args: string[]): ChildProcess {
    const child = spawn(cursorSamplerBinaryPath(), args, { stdio: 'ignore' })
    child.on('error', () => {})
    return child
  }

  /** Overridable seam so tests can simulate a missing/failed-to-build binary without compiling. */
  protected ensureCursorSamplerBinary(): string {
    return ensureCursorSamplerBinary()
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
    const windows = await this.windowListProvider()
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
    const result = await handleConnect(params, this.ctx) as CreateSessionResult
    const session = this.ctx.sessions.get(result.sessionId)
    if (session) {
      this.emit({
        type: 'session.created',
        sessionId: session.id,
        data: {
          session: {
            id: session.id,
            name: session.name,
            platform: session.platform,
            steps: session.steps.length,
            recordingState: this.ctx.sessions.getRun(session.id)?.recording.state ?? 'idle',
            createdAt: new Date(session.createdAt).toISOString(),
          },
        },
      })
    }
    return result
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
    return handleCapture({ ...params, type: 'screenshot' }, this.ctx)
  }

  async startRecording(params: StartRecordingParams): Promise<StartRecordingResult> {
    const session = this.ctx.sessions.get(params.sessionId)
    if (!session) throw new DaemonApiError('not_found', `Session ${params.sessionId} not found`, { status: 404 })
    if (session.platform !== 'macos' || !session.target.appName) {
      throw new DaemonApiError(
        'recording_failed',
        'startRecording currently requires a macOS session with an app target.',
        { status: 400, retryable: false },
      )
    }
    if (this.recordings.forSession(params.sessionId)) {
      throw new DaemonApiError(
        'conflict',
        `Session ${params.sessionId} already has an active recording.`,
        { status: 409, retryable: false },
      )
    }

    const target = await this.resolveRecordingTarget(session.target.appName, session.name)
    const recordingId = `recording-${randomUUID().slice(0, 8)}`
    const sessionDir = this.ctx.sessions.sessionDir(params.sessionId)
    await mkdir(sessionDir, { recursive: true })
    const outPath = join(sessionDir, `${recordingId}.mp4`)
    const startedAt = Date.now()
    const fps = params.fps ?? 60
    const codec = params.codec ?? 'h264'
    const bitrate = params.bitrate ?? '8M'
    const captureAudio = params.captureAudio ?? false
    const maxDurationSeconds = 300

    await this.keepAwake.recordingStarted(recordingId)
    let handle: NativeRecordingHandle
    try {
      handle = await this.singleWindowRecordingRunner({
        recordingId,
        sessionId: params.sessionId,
        app: session.target.appName,
        title: session.name,
        outPath,
        fps,
        codec,
        bitrate,
        captureAudio,
        maxDurationSeconds,
      })
    } catch (error) {
      await this.keepAwake.recordingStopped(recordingId).catch(() => {})
      throw new DaemonApiError(
        'recording_failed',
        `startRecording failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          status: 500,
          hint: 'Verify the target window is visible/on-screen and Screen Recording permission is granted to the signed Spectra daemon helper.',
          retryable: false,
          cause: error,
        },
      )
    }
    let cursorSampler: ActiveCursorSampler | undefined
    let cursorSamplerSkippedWarning: string | undefined
    if (params.captureCursor === true) {
      try {
        this.ensureCursorSamplerBinary()
      } catch {
        // Binary missing/stale and (re)build failed — skip the spawn entirely
        // rather than shell out to a binary we know is broken. The recording
        // itself still succeeds; the gap is surfaced as an artifact warning
        // at stop time instead of failing silently.
        cursorSamplerSkippedWarning = CURSOR_SAMPLER_SILENT_FAILURE_WARNING
      }
      if (!cursorSamplerSkippedWarning) {
        try {
          cursorSampler = this.startCursorSampler(recordingId, sessionDir, fps, maxDurationSeconds)
        } catch (error) {
          await handle.abort().catch(() => {})
          await this.keepAwake.recordingStopped(recordingId).catch(() => {})
          throw new DaemonApiError(
            'recording_failed',
            `startRecording cursor sampler failed: ${error instanceof Error ? error.message : String(error)}`,
            { status: 500, retryable: false, cause: error },
          )
        }
      }
    }

    this.recordings.add({
      recordingId,
      sessionId: params.sessionId,
      target,
      startedAt,
      outPath,
      preset: params.preset,
      fps,
      codec,
      bitrate,
      handle,
      cursorSampler,
      cursorSamplerSkippedWarning,
    })
    const recording = await this.ctx.sessions.setRecordingStatus(params.sessionId, {
      state: 'recording',
      recordingId,
      preset: params.preset,
      startedAt,
      rawPath: outPath,
      fps,
      codec,
      bitrate,
      width: handle.started.width,
      height: handle.started.height,
      source: `${target.appName}${target.title ? `: ${target.title}` : ''}`,
      sourceVerified: true,
    })
    this.emitRecordingStatus(params.sessionId, recording)
    return {
      recordingId,
      preset: params.preset,
      startedAt,
      fps,
      codec,
      bitrate,
    }
  }

  async stopRecording(params: StopRecordingParams): Promise<StopRecordingResult> {
    const session = this.ctx.sessions.get(params.sessionId)
    if (!session) throw new DaemonApiError('not_found', `Session ${params.sessionId} not found`, { status: 404 })

    const active = this.recordings.forSession(params.sessionId)
    if (!active) {
      return {
        preset: params.preset,
        alreadyStopped: true,
        error: `No active recording for session ${params.sessionId}`,
      }
    }

    this.recordings.remove(active.recordingId)
    let stopped: NativeStopRecordingOutput
    try {
      await this.ctx.sessions.setRecordingStatus(params.sessionId, {
        state: 'encoding',
        recordingId: active.recordingId,
        preset: active.preset,
        startedAt: active.startedAt,
        rawPath: active.outPath,
        fps: active.fps,
        codec: active.codec,
        bitrate: active.bitrate,
      })
      stopped = await active.handle.stop()
      await this.stopCursorSampler(active.cursorSampler).catch(() => {})
    } catch (error) {
      await this.stopCursorSampler(active.cursorSampler).catch(() => {})
      await this.keepAwake.recordingStopped(active.recordingId).catch(() => {})
      await active.handle.abort().catch(() => {})
      const failed = await this.ctx.sessions.setRecordingStatus(params.sessionId, {
        state: 'failed',
        recordingId: active.recordingId,
        preset: active.preset,
        startedAt: active.startedAt,
        stoppedAt: Date.now(),
        rawPath: active.outPath,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {})
      if (failed) this.emitRecordingStatus(params.sessionId, failed)
      throw new DaemonApiError(
        'recording_failed',
        `stopRecording failed: ${error instanceof Error ? error.message : String(error)}`,
        { status: 500, retryable: false, cause: error },
      )
    }

    await this.keepAwake.recordingStopped(active.recordingId).catch(() => {})
    const stoppedAt = Date.now()
    const path = stopped.path || active.outPath
    const file = await stat(path).catch(() => undefined)
    const probed = await probeVideo(path).catch(() => undefined)
    const blackFrameGuard = probeRecordingBlackFrames(path)
    const warnings: string[] = []
    if (blackFrameGuard.allBlack) {
      warnings.push(
        `Output appears all-black (mean luminance ${blackFrameGuard.meanLuma?.toFixed(1)} < `
        + `${COMPOSITE_WORKER_DEFAULTS.blackThreshold} across ${blackFrameGuard.sampleCount} sampled frames).`,
      )
    } else if (blackFrameGuard.skipped) {
      warnings.push('Black-frame guard skipped; ffmpeg was unavailable or no luminance samples were produced.')
    }
    const durationMs = stopped.durationMs ?? probed?.durationMs ?? Math.max(0, stoppedAt - active.startedAt)
    const sizeBytes = stopped.sizeBytes ?? file?.size
    const cursorTelemetryPath = await this.cursorTelemetryPathIfPresent(active.cursorSampler)
    if (active.cursorSamplerSkippedWarning) {
      warnings.push(active.cursorSamplerSkippedWarning)
    } else if (active.cursorSampler && !cursorTelemetryPath) {
      warnings.push(CURSOR_SAMPLER_SILENT_FAILURE_WARNING)
    }
    const saved = await this.ctx.sessions.setRecordingStatus(params.sessionId, {
      state: 'saved',
      recordingId: active.recordingId,
      preset: active.preset,
      startedAt: active.startedAt,
      stoppedAt,
      rawPath: active.outPath,
      path,
      durationMs,
      sizeBytes,
      codec: stopped.codec ?? probed?.codec ?? active.codec,
      fps: stopped.fps ?? probed?.fps ?? active.fps,
      width: stopped.width ?? probed?.width,
      height: stopped.height ?? probed?.height,
      bitrate: active.bitrate,
      droppedFrames: stopped.droppedFrames,
      source: `${active.target.appName}${active.target.title ? `: ${active.target.title}` : ''}`,
      sourceVerified: true,
      ...(cursorTelemetryPath ? { cursorTelemetryPath } : {}),
    })
    this.emitRecordingStatus(params.sessionId, saved)
    const metadata: JsonObject = {
      recordingId: active.recordingId,
      appName: active.target.appName,
      title: active.target.title,
      blackFrameMeanLuma: blackFrameGuard.meanLuma,
      blackFrameAllBlack: blackFrameGuard.allBlack,
      blackFrameSampleCount: blackFrameGuard.sampleCount,
      warnings,
    }
    if (cursorTelemetryPath) metadata.cursorTelemetryPath = cursorTelemetryPath
    const artifact = await this.ctx.sessions.addArtifact(params.sessionId, {
      type: 'video',
      path,
      format: stopped.format ?? 'mp4',
      label: 'Window recording',
      sizeBytes,
      metadata,
    })
    this.emitArtifactAdded(params.sessionId, artifact as unknown as CaptureRunArtifact)
    return {
      recordingId: active.recordingId,
      preset: active.preset,
      path,
      format: stopped.format ?? 'mp4',
      durationMs,
      sizeBytes,
      codec: stopped.codec ?? probed?.codec ?? active.codec,
      fps: stopped.fps ?? probed?.fps ?? active.fps,
      width: stopped.width ?? probed?.width,
      height: stopped.height ?? probed?.height,
      droppedFrames: stopped.droppedFrames,
      alreadyStopped: false,
    }
  }

  async recordComposite(params: RecordCompositeParams): Promise<RecordCompositeResult> {
    if (params.async === true) return this.startCompositeRecording(params)
    return this.recordCompositeSync(params)
  }

  async getRecording(params: GetRecordingParams): Promise<GetRecordingResult> {
    const composite = this.compositeRecordings.get(params.recordingId)
    if (composite) return { recording: composite }

    const active = this.recordings.get(params.recordingId)
    if (active) {
      return {
        recording: {
          recordingId: active.recordingId,
          kind: 'single-window',
          state: 'recording',
          sessionId: active.sessionId,
          startedAt: active.startedAt,
          updatedAt: Date.now(),
          outPath: active.outPath,
        },
      }
    }

    throw new DaemonApiError('not_found', `Recording ${params.recordingId} not found`, {
      status: 404,
      retryable: false,
    })
  }

  private async recordCompositeSync(params: RecordCompositeParams): Promise<RecordCompositeCompletedResult> {
    const recordingId = `composite-${randomUUID().slice(0, 8)}`
    const startedAt = Date.now()
    const compositeSession = params.sessionId && this.ctx.sessions.get(params.sessionId)
      ? params.sessionId
      : undefined
    await this.keepAwake.recordingStarted(recordingId)
    try {
      if (compositeSession) {
        const recording = await this.ctx.sessions.setRecordingStatus(compositeSession, {
          state: 'recording',
          recordingId,
          startedAt,
          rawPath: params.outPath,
          fps: params.fps,
          source: `${params.appA} + ${params.appB}`,
          sourceVerified: true,
        })
        this.emitRecordingStatus(compositeSession, recording)
      }
      const result = await this.recordCompositeWorker(params)
      const artifact = result.ok && result.output
        ? await this.addCompositeArtifact(params, result, recordingId)
        : undefined
      if (compositeSession) {
        const recording = await this.ctx.sessions.setRecordingStatus(compositeSession, {
          state: result.ok ? 'saved' : 'failed',
          recordingId,
          startedAt,
          stoppedAt: Date.now(),
          rawPath: params.outPath,
          path: result.output,
          durationMs: params.durationSeconds !== undefined ? Math.round(params.durationSeconds * 1000) : undefined,
          fps: params.fps,
          source: `${params.appA} + ${params.appB}`,
          sourceVerified: true,
          error: result.ok ? undefined : result.error,
        })
        this.emitRecordingStatus(compositeSession, recording)
      }
      if (artifact && params.sessionId) this.emitArtifactAdded(params.sessionId, artifact)
      return artifact ? { ...result, recordingId, artifactId: artifact.id } : { ...result, recordingId }
    } catch (error) {
      if (compositeSession) {
        const recording = await this.ctx.sessions.setRecordingStatus(compositeSession, {
          state: 'failed',
          recordingId,
          startedAt,
          stoppedAt: Date.now(),
          rawPath: params.outPath,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined)
        if (recording) this.emitRecordingStatus(compositeSession, recording)
      }
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

  private async startCompositeRecording(params: RecordCompositeParams): Promise<RecordCompositeAcceptedResult> {
    const recordingId = `composite-${randomUUID().slice(0, 8)}`
    const startedAt = Date.now()
    const compositeSession = params.sessionId && this.ctx.sessions.get(params.sessionId)
      ? params.sessionId
      : undefined
    if (compositeSession && this.compositeRecordings.forSession(compositeSession)) {
      throw new DaemonApiError(
        'conflict',
        `Session ${compositeSession} already has an active composite recording.`,
        { status: 409, retryable: false },
      )
    }

    await this.keepAwake.recordingStarted(recordingId)
    try {
      this.compositeRecordings.add({
        recordingId,
        kind: 'composite',
        state: 'recording',
        sessionId: compositeSession,
        startedAt,
        updatedAt: startedAt,
        outPath: params.outPath,
      })
      if (compositeSession) {
        const recording = await this.ctx.sessions.setRecordingStatus(compositeSession, {
          state: 'recording',
          recordingId,
          startedAt,
          rawPath: params.outPath,
          fps: params.fps,
          source: `${params.appA} + ${params.appB}`,
          sourceVerified: true,
        })
        this.emitRecordingStatus(compositeSession, recording)
      }
    } catch (error) {
      this.compositeRecordings.remove(recordingId)
      await this.keepAwake.recordingStopped(recordingId).catch(() => {})
      throw error
    }

    void this.finishCompositeRecording(recordingId, params, startedAt, compositeSession)

    return {
      ok: true,
      accepted: true,
      async: true,
      recordingId,
      state: 'recording',
      startedAt,
      sessionId: compositeSession,
      poll: {
        operation: 'getRecording',
        params: { recordingId },
      },
    }
  }

  private async finishCompositeRecording(
    recordingId: string,
    params: RecordCompositeParams,
    startedAt: number,
    compositeSession: string | undefined,
  ): Promise<void> {
    try {
      const result = await this.recordCompositeWorker(params)
      const artifact = result.ok && result.output
        ? await this.addCompositeArtifact(params, result, recordingId)
        : undefined
      const stoppedAt = Date.now()
      const current = this.compositeRecordings.get(recordingId)
      if (current?.state === 'aborted') return

      const status = this.compositeRecordings.update(recordingId, {
        state: result.ok ? 'saved' : 'failed',
        updatedAt: stoppedAt,
        stoppedAt,
        path: result.output,
        artifactId: artifact?.id,
        error: result.ok ? undefined : result.error,
      })
      this.compositeRecordings.complete(recordingId)

      if (compositeSession) {
        const recording = await this.ctx.sessions.setRecordingStatus(compositeSession, {
          state: result.ok ? 'saved' : 'failed',
          recordingId,
          startedAt,
          stoppedAt,
          rawPath: params.outPath,
          path: result.output,
          durationMs: params.durationSeconds !== undefined ? Math.round(params.durationSeconds * 1000) : undefined,
          fps: params.fps,
          source: `${params.appA} + ${params.appB}`,
          sourceVerified: true,
          error: result.ok ? undefined : result.error,
        })
        this.emitRecordingStatus(compositeSession, recording)
      }
      if (artifact && compositeSession) this.emitArtifactAdded(compositeSession, artifact)
      void status
    } catch (error) {
      const stoppedAt = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      const current = this.compositeRecordings.get(recordingId)
      if (current?.state !== 'aborted') {
        this.compositeRecordings.update(recordingId, {
          state: 'failed',
          updatedAt: stoppedAt,
          stoppedAt,
          error: message,
        })
        this.compositeRecordings.complete(recordingId)
        if (compositeSession) {
          const recording = await this.ctx.sessions.setRecordingStatus(compositeSession, {
            state: 'failed',
            recordingId,
            startedAt,
            stoppedAt,
            rawPath: params.outPath,
            error: message,
          }).catch(() => undefined)
          if (recording) this.emitRecordingStatus(compositeSession, recording)
        }
      }
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

  /**
   * AX-first, focused-window-scoped computer use. Builds a ComputerUse over the
   * native AX bridge (overridable seam for tests) and dispatches by action. AX
   * failure modes are mapped to actionable daemon errors, never a crash.
   */
  async computerUse(params: ComputerUseParams): Promise<ComputerUseResult> {
    const target: AxTarget = {}
    if (params.pid !== undefined) target.pid = params.pid
    else if (params.app !== undefined) target.app = params.app

    const threshold = params.action === 'snapshot' ? params.threshold : undefined
    const cu = await this.getOrCreateComputerUse(target)
    try {
      switch (params.action) {
        case 'snapshot': {
          const snap = await cu.snapshotFocusedWindow(
            threshold !== undefined ? { visionFallbackThreshold: threshold } : {},
          )
          return { action: 'snapshot', ...snap }
        }
        case 'act': {
          const outcome = await cu.act(params.op)
          return {
            action: 'act',
            success: outcome.success,
            matched: outcome.matched,
            verified: outcome.verified,
            actualValue: outcome.actualValue,
            error: outcome.error,
            needsVisionFallback: outcome.needsVisionFallback,
          }
        }
        case 'fill-form': {
          const result = await cu.fillForm(params.fields)
          return { action: 'fill-form', ...result }
        }
      }
    } catch (error) {
      if (error instanceof AxPermissionError) {
        throw new DaemonApiError('permission_denied', error.message, {
          status: 403,
          hint: 'Grant Accessibility permission to the Spectra daemon helper in System Settings → Privacy & Security → Accessibility.',
          retryable: false,
        })
      }
      throw error
    }
  }

  /** Overridable seam so tests can inject a fake AX bridge without a GUI session. */
  protected createAxBridgePort(): AxBridgePort {
    return new NativeAxBridgePort()
  }

  /** Overridable seam so tests can inject or suppress the native vision fallback. */
  protected async createVisionFallback(port: AxBridgePort, target: AxTarget): Promise<VisionFallback | undefined> {
    return NativeVisionFallback.create(port, target)
  }

  /**
   * Returns the persistent ComputerUse for `target`, constructing it lazily
   * on first use. Reusing the instance across calls is what lets `act`'s
   * lazy self-snapshot (computer-use.ts) actually build up a cache that
   * later act/click/setValue calls in the same target benefit from — a
   * fresh-per-call instance (the pre-fix behavior) never accumulated state.
   */
  private async getOrCreateComputerUse(target: AxTarget): Promise<ComputerUse> {
    const key = target.pid !== undefined ? `pid:${target.pid}` : target.app !== undefined ? `app:${target.app}` : 'focused'
    let cu = this.computerUseInstances.get(key)
    if (!cu) {
      const port = this.createAxBridgePort()
      const visionFallback = await this.createVisionFallback(port, target)
      cu = new ComputerUse(port, { target, visionFallback })
      this.computerUseInstances.set(key, cu)
    }
    return cu
  }

  async close(): Promise<void> {
    await Promise.all(this.recordings.list().map(async (recording) => {
      this.recordings.remove(recording.recordingId)
      await recording.handle.abort().catch(() => {})
      await this.stopCursorSampler(recording.cursorSampler).catch(() => {})
      await this.keepAwake.recordingStopped(recording.recordingId).catch(() => {})
      const status = await this.ctx.sessions.setRecordingStatus(recording.sessionId, {
        state: 'aborted',
        recordingId: recording.recordingId,
        preset: recording.preset,
        startedAt: recording.startedAt,
        stoppedAt: Date.now(),
        rawPath: recording.outPath,
      }).catch(() => {})
      if (status) this.emitRecordingStatus(recording.sessionId, status)
    }))
    await Promise.all(this.compositeRecordings.active().map(async (recording) => {
      const stoppedAt = Date.now()
      this.compositeRecordings.update(recording.recordingId, {
        state: 'aborted',
        updatedAt: stoppedAt,
        stoppedAt,
      })
      this.compositeRecordings.complete(recording.recordingId)
      await this.keepAwake.recordingStopped(recording.recordingId).catch(() => {})
      if (recording.sessionId) {
        const status = await this.ctx.sessions.setRecordingStatus(recording.sessionId, {
          state: 'aborted',
          recordingId: recording.recordingId,
          startedAt: recording.startedAt,
          stoppedAt,
          rawPath: recording.outPath,
        }).catch(() => undefined)
        if (status) this.emitRecordingStatus(recording.sessionId, status)
      }
    }))
    await this.keepAwake.close()
  }

  private startCursorSampler(
    recordingId: string,
    sessionDir: string,
    fps: number,
    maxDurationSeconds: number,
  ): ActiveCursorSampler {
    const outPath = join(sessionDir, `${recordingId}.cursor.json`)
    const args = [
      '--duration', String(maxDurationSeconds),
      '--fps', String(fps),
      '--out', outPath,
    ]
    return {
      child: this.spawnCursorSampler(args),
      outPath,
    }
  }

  private async stopCursorSampler(sampler: ActiveCursorSampler | undefined): Promise<void> {
    if (!sampler) return
    const child = sampler.child
    // Spawn failed (no pid was ever assigned) — nothing to signal, and
    // waiting out the SIGTERM/SIGKILL timeouts here would stall stopRecording
    // for ~3s for no reason.
    if (child.pid === undefined) return
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    await waitForChildExit(child, 2_000).catch(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    })
    await waitForChildExit(child, 1_000).catch(() => {})
  }

  private async cursorTelemetryPathIfPresent(
    sampler: ActiveCursorSampler | undefined,
  ): Promise<string | undefined> {
    if (!sampler) return undefined
    return stat(sampler.outPath)
      .then(() => sampler.outPath)
      .catch(() => undefined)
  }

  private async addCompositeArtifact(
    params: RecordCompositeParams,
    result: RecordCompositeCompletedResult,
    recordingId: string,
  ): Promise<CaptureRunArtifact | undefined> {
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
    return artifact as unknown as CaptureRunArtifact
  }

  private emit(event: DaemonEvent): void {
    this.eventSink?.(event)
  }

  private emitRecordingStatus(sessionId: string, recording: CaptureRunRecording): void {
    this.emit({
      type: 'recording.status',
      sessionId,
      data: { ...recording, sessionId },
    })
  }

  private emitArtifactAdded(sessionId: string, artifact: CaptureRunArtifact): void {
    this.emit({
      type: 'artifact.added',
      sessionId,
      data: artifact,
    })
  }

  private async resolveRecordingTarget(app: string, titleHint?: string): Promise<WindowRecord> {
    const appNeedle = app.toLowerCase()
    const windows = await this.windowListProvider()
    let candidates = windows.filter((window) => {
      const appName = window.appName.toLowerCase()
      const bundle = window.bundleIdentifier?.toLowerCase() ?? ''
      return window.onScreen
        && window.layer === 0
        && window.width >= 100
        && window.height >= 100
        && (appName.includes(appNeedle) || bundle.includes(appNeedle))
    })
    if (candidates.length === 0) {
      throw new DaemonApiError(
        'recording_failed',
        `No on-screen ScreenCaptureKit window found for app ${app}`,
        { status: 404, retryable: false },
      )
    }
    // A title hint (the session name) disambiguates when several windows of the
    // same app are open — record the window whose title matches, not the largest.
    if (titleHint && titleHint.trim().length > 0) {
      const needle = titleHint.toLowerCase()
      const titled = candidates.filter((window) => window.title.toLowerCase().includes(needle))
      if (titled.length > 0) candidates = titled
    }
    return candidates.sort((left, right) => {
      const leftTitled = left.title.length > 0
      const rightTitled = right.title.length > 0
      if (leftTitled !== rightTitled) return leftTitled ? -1 : 1
      if (left.layer !== right.layer) return left.layer - right.layer
      return (right.width * right.height) - (left.width * left.height)
    })[0]
  }
}

interface NativeStartRecordingInput {
  recordingId: string
  sessionId: string
  app: string
  title?: string
  outPath: string
  fps: number
  codec: string
  bitrate: string
  captureAudio: boolean
  maxDurationSeconds: number
}

interface NativeStartRecordingOutput {
  recordingId: string
  path: string
  startedAt?: number
  fps?: number
  codec?: string
  bitrate?: string
  width?: number
  height?: number
}

interface NativeStopRecordingOutput {
  recordingId?: string
  path?: string
  format?: string
  durationMs?: number
  sizeBytes?: number
  codec?: string
  fps?: number
  width?: number
  height?: number
  droppedFrames?: number
}

interface NativeRecordingHandle {
  pid?: number
  started: NativeStartRecordingOutput
  stop(): Promise<NativeStopRecordingOutput>
  abort(): Promise<void>
}

interface ActiveCursorSampler {
  child: ChildProcess
  outPath: string
}

interface ActiveRecording {
  recordingId: string
  sessionId: string
  target: WindowRecord
  startedAt: number
  outPath: string
  preset?: StartRecordingParams['preset']
  fps: number
  codec: string
  bitrate: string
  handle: NativeRecordingHandle
  cursorSampler?: ActiveCursorSampler
  /** Set when captureCursor was requested but the sampler was never spawned (binary missing/failed to build). */
  cursorSamplerSkippedWarning?: string
}

const CURSOR_SAMPLER_SILENT_FAILURE_WARNING =
  'cursor telemetry requested but the sampler produced no output (is spectra-cursor-sampler built? run npm run build:cursor-sampler)'

class RecordingRegistry {
  private readonly byId = new Map<string, ActiveRecording>()
  private readonly bySession = new Map<string, string>()

  add(recording: ActiveRecording): void {
    if (this.byId.has(recording.recordingId)) {
      throw new Error(`Duplicate recordingId ${recording.recordingId}`)
    }
    if (this.bySession.has(recording.sessionId)) {
      throw new Error(`Session ${recording.sessionId} already has an active recording`)
    }
    this.byId.set(recording.recordingId, recording)
    this.bySession.set(recording.sessionId, recording.recordingId)
  }

  forSession(sessionId: string): ActiveRecording | undefined {
    const recordingId = this.bySession.get(sessionId)
    return recordingId ? this.byId.get(recordingId) : undefined
  }

  get(recordingId: string): ActiveRecording | undefined {
    return this.byId.get(recordingId)
  }

  remove(recordingId: string): ActiveRecording | undefined {
    const recording = this.byId.get(recordingId)
    if (!recording) return undefined
    this.byId.delete(recordingId)
    this.bySession.delete(recording.sessionId)
    return recording
  }

  list(): ActiveRecording[] {
    return [...this.byId.values()]
  }
}

class CompositeRecordingRegistry {
  private readonly byId = new Map<string, RecordingStatus>()
  private readonly activeBySession = new Map<string, string>()

  add(recording: RecordingStatus): void {
    if (this.byId.has(recording.recordingId)) {
      throw new Error(`Duplicate recordingId ${recording.recordingId}`)
    }
    if (recording.sessionId && this.activeBySession.has(recording.sessionId)) {
      throw new Error(`Session ${recording.sessionId} already has an active composite recording`)
    }
    this.byId.set(recording.recordingId, recording)
    if (recording.sessionId && recording.state === 'recording') {
      this.activeBySession.set(recording.sessionId, recording.recordingId)
    }
  }

  get(recordingId: string): RecordingStatus | undefined {
    return this.byId.get(recordingId)
  }

  forSession(sessionId: string): RecordingStatus | undefined {
    const recordingId = this.activeBySession.get(sessionId)
    return recordingId ? this.byId.get(recordingId) : undefined
  }

  update(recordingId: string, patch: Partial<RecordingStatus>): RecordingStatus | undefined {
    const current = this.byId.get(recordingId)
    if (!current) return undefined
    const next = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? Date.now(),
    }
    this.byId.set(recordingId, next)
    if (next.sessionId && next.state === 'recording') {
      this.activeBySession.set(next.sessionId, recordingId)
    } else if (next.sessionId && this.activeBySession.get(next.sessionId) === recordingId) {
      this.activeBySession.delete(next.sessionId)
    }
    return next
  }

  complete(recordingId: string): void {
    const recording = this.byId.get(recordingId)
    if (recording?.sessionId && this.activeBySession.get(recording.sessionId) === recordingId) {
      this.activeBySession.delete(recording.sessionId)
    }
  }

  remove(recordingId: string): RecordingStatus | undefined {
    const recording = this.byId.get(recordingId)
    if (!recording) return undefined
    this.byId.delete(recordingId)
    if (recording.sessionId && this.activeBySession.get(recording.sessionId) === recordingId) {
      this.activeBySession.delete(recording.sessionId)
    }
    return recording
  }

  active(): RecordingStatus[] {
    return [...this.byId.values()].filter((recording) => recording.state === 'recording')
  }
}

interface NativeRpcResponse<T> {
  id: number
  result?: T
  error?: {
    code?: number
    message?: string
  }
}

class NativeRecordingProcess implements NativeRecordingHandle {
  readonly pid?: number
  started!: NativeStartRecordingOutput

  private readonly readline: Interface
  private readonly stderrChunks: Buffer[] = []
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private nextId = 0
  private closed = false

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly input: NativeStartRecordingInput,
  ) {
    this.pid = child.pid
    this.readline = createInterface({ input: child.stdout })
    this.readline.on('line', (line) => this.handleLine(line))
    child.stderr.on('data', (chunk: Buffer) => this.stderrChunks.push(Buffer.from(chunk)))
    child.on('error', (error) => this.rejectAll(error))
    child.on('close', (code, signal) => {
      this.closed = true
      this.rejectAll(new Error(`spectra-native recording process exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`))
      this.readline.close()
    })
  }

  async start(): Promise<this> {
    this.started = await this.send<NativeStartRecordingOutput>('startRecording', {
      recordingId: this.input.recordingId,
      sessionId: this.input.sessionId,
      app: this.input.app,
      title: this.input.title,
      outPath: this.input.outPath,
      fps: this.input.fps,
      codec: this.input.codec,
      bitrate: this.input.bitrate,
      captureAudio: this.input.captureAudio,
      maxDuration: this.input.maxDurationSeconds,
    }, 15_000)
    return this
  }

  async stop(): Promise<NativeStopRecordingOutput> {
    const result = await this.send<NativeStopRecordingOutput>('stopRecording', {
      recordingId: this.input.recordingId,
      sessionId: this.input.sessionId,
    }, 45_000)
    await this.quit()
    return result
  }

  async abort(): Promise<void> {
    if (this.closed) return
    await this.quit().catch(() => {})
    if (!this.closed) {
      this.child.kill('SIGTERM')
      await waitForChildExit(this.child, 2_000).catch(() => {
        if (!this.closed) this.child.kill('SIGKILL')
      })
    }
  }

  private async quit(): Promise<void> {
    if (this.closed) return
    await this.send('quit', {}, 1_000).catch(() => {})
    await waitForChildExit(this.child, 2_000).catch(() => {})
  }

  private send<T>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('spectra-native recording process is closed'))
    }
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Native recording request '${method}' timed out after ${timeoutMs}ms${this.stderrDetail()}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let parsed: NativeRpcResponse<unknown>
    try {
      parsed = JSON.parse(trimmed) as NativeRpcResponse<unknown>
    } catch {
      return
    }
    const pending = this.pending.get(parsed.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(parsed.id)
    if (parsed.error) {
      pending.reject(new Error(parsed.error.message ?? `Native recording error ${parsed.error.code ?? ''}`.trim()))
    } else {
      pending.resolve(parsed.result)
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private stderrDetail(): string {
    const stderr = Buffer.concat(this.stderrChunks).toString('utf8').trim()
    return stderr ? `\n${stderr}` : ''
  }
}

async function startNativeSingleWindowRecording(input: NativeStartRecordingInput): Promise<NativeRecordingHandle> {
  const binary = ensureBinary()
  const child = spawn(binary, [], { stdio: 'pipe' })
  const process = new NativeRecordingProcess(child, input)
  try {
    return await process.start()
  } catch (error) {
    await process.abort().catch(() => {})
    throw error
  }
}

function cursorSamplerBinaryPath(): string {
  return join(homedir(), '.spectra', 'bin', 'spectra-cursor-sampler')
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('close', onClose)
      reject(new Error('Timed out waiting for child process exit'))
    }, timeoutMs)
    const onClose = () => {
      clearTimeout(timer)
      resolve()
    }
    child.once('close', onClose)
  })
}

function probeRecordingBlackFrames(outPath: string): BlackFrameGuard {
  const ffmpeg = detectFfmpeg()
  if (!ffmpeg) return { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true }
  try {
    const result = spawnSync(
      ffmpeg,
      [
        '-nostats',
        '-i', outPath,
        '-vf', 'fps=2,signalstats,metadata=print:file=-',
        '-an',
        '-f', 'null',
        '-',
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
    return parseLuminance(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  } catch {
    return { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true }
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
    const staleness = diagnoseStaleness(permission, state)
    return permissionStatus(permission, state, now, staleness)
  }))
  return states
}

/**
 * The helper binary whose code-signing identity governs a permission's grant.
 * Screen Recording is preflighted by the preflight helper; the daemon's own
 * Accessibility trust follows the launcher that execs it. Permissions with no
 * spectra-owned helper (automation, developer-tools) return null and are never
 * staleness-tracked. Uses the exported install path (never triggers a compile).
 */
function permissionHelperBinary(permission: PermissionKind): string | null {
  switch (permission) {
    case 'screen-recording':
      return SCREEN_RECORDING_PREFLIGHT_PATH
    case 'accessibility':
      return DAEMON_LAUNCHER_PATH
    default:
      return null
  }
}

/**
 * On a granted probe, pin "last known granted" to the helper's current cdhash.
 * On a denied probe, report `grant_stale_rebuild` when the helper's cdhash has
 * changed since that grant — i.e. denied *because Spectra was rebuilt*, not
 * because it was never granted. Best-effort; never throws into a probe.
 */
function diagnoseStaleness(
  permission: PermissionKind,
  state: PermissionState,
): PermissionStaleness | undefined {
  const helper = permissionHelperBinary(permission)
  if (!helper) return undefined
  try {
    if (state === 'granted') {
      recordGrant(permission, helper)
      // The grant is live again → retire any "re-grant needed" marker so the
      // daemon-startup warning stops firing (otherwise it warns forever).
      clearRegrantMarker()
      return undefined
    }
    if (state === 'denied') {
      return assessGrantStaleness(permission, helper).stale ? 'grant_stale_rebuild' : undefined
    }
  } catch {
    // Diagnostic only — a failed cdhash read must not change the probe result.
  }
  return undefined
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
  if (permission === 'screen-recording') {
    try {
      await execFileAsync(ensureScreenRecordingPreflightBinary(), [], {
        timeout: 2_000,
        maxBuffer: 1024 * 1024,
      })
      return 'granted'
    } catch {
      return 'denied'
    }
  }
  // macOS exposes no non-prompting, daemon-safe public probe for Automation or
  // Developer Tools consent equivalent to AXIsProcessTrusted or CGPreflight.
  // Keep these unknown rather than fabricating a value from brittle UI state.
  return 'unknown'
}

function permissionStatus(
  permission: PermissionKind,
  state: PermissionState,
  lastCheckedAt: number,
  staleness?: PermissionStaleness,
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
    message: staleness === 'grant_stale_rebuild'
      ? 'Spectra was rebuilt since this permission was granted. Remove the old Spectra entry in System Settings › Privacy & Security and re-grant.'
      : undefined,
    staleness,
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
