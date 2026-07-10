import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resetProcessRunner, setProcessRunner } from '../../src/media/pipeline.js'
import { API_VERSION, type DaemonEvent } from '../../src/contract/wire.js'
import { createDaemonCore } from '../../src/daemon/core.js'
import { CoreApiImplementation } from '../../src/daemon/core-impl.js'
import { eventEnvelope, formatSseFrame, sseFrame, successEnvelope } from '../../src/daemon/envelope.js'
import type { KeepAwakeController } from '../../src/daemon/keep-awake.js'
import { createContext } from '../../src/mcp/context.js'

class FakeKeepAwake implements KeepAwakeController {
  readonly events: string[] = []
  private readonly recordings = new Set<string>()

  get activeRecordings(): number {
    return this.recordings.size
  }

  get engaged(): boolean {
    return this.recordings.size > 0
  }

  async recordingStarted(recordingId: string): Promise<void> {
    this.events.push(`start:${recordingId}`)
    this.recordings.add(recordingId)
  }

  async recordingStopped(recordingId: string): Promise<void> {
    this.events.push(`stop:${recordingId}`)
    this.recordings.delete(recordingId)
  }

  async close(): Promise<void> {
    this.events.push('close')
    this.recordings.clear()
  }
}

class FakeSamplerChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed = false
  killSignals: Array<NodeJS.Signals | number | undefined> = []
  pid: number | undefined

  // Real ChildProcess leaves `pid` undefined when spawn fails (ENOENT/crash).
  // Default to a realistic pid so pre-existing tests model a live process;
  // pass `null` explicitly to model a failed/crashed spawn (f3) — NOTE: a
  // default parameter substitutes on an explicit `undefined` argument too,
  // so `null` (not `undefined`) is the sentinel that actually reaches here.
  constructor(pid: number | null = 4242) {
    super()
    this.pid = pid === null ? undefined : pid
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true
    this.killSignals.push(signal)
    this.signalCode = typeof signal === 'string' ? signal : 'SIGTERM'
    queueMicrotask(() => this.emit('close', this.exitCode, this.signalCode))
    return true
  }
}

class CursorSamplerTestCore extends CoreApiImplementation {
  readonly cursorSamplerBinaries: string[] = []
  readonly cursorSamplerArgs: string[][] = []
  readonly cursorSamplerChildren: FakeSamplerChild[] = []

  // Avoid invoking the real native compiler from unit tests.
  protected override ensureCursorSamplerBinary(): string {
    return '/fake/path/spectra-cursor-sampler'
  }

  protected override spawnCursorSampler(binaryPath: string, args: string[]): ChildProcess {
    this.cursorSamplerBinaries.push(binaryPath)
    this.cursorSamplerArgs.push(args)
    const child = new FakeSamplerChild()
    this.cursorSamplerChildren.push(child)
    return child as unknown as ChildProcess
  }
}

/** f2: simulates ensureCursorSamplerBinary() failing to (re)build the binary. */
class EnsureCursorSamplerBinaryFailsTestCore extends CoreApiImplementation {
  readonly cursorSamplerArgs: string[][] = []

  protected override ensureCursorSamplerBinary(): string {
    throw new Error('compile failed: no toolchain available')
  }

  protected override spawnCursorSampler(_binaryPath: string, args: string[]): ChildProcess {
    this.cursorSamplerArgs.push(args)
    return new FakeSamplerChild() as unknown as ChildProcess
  }
}

/** f2/f3: simulates a spawn that produces a pidless/crashing child (no telemetry, no pid). */
class PidlessCursorSamplerTestCore extends CoreApiImplementation {
  readonly cursorSamplerChildren: FakeSamplerChild[] = []

  protected override ensureCursorSamplerBinary(): string {
    return '/fake/path/spectra-cursor-sampler'
  }

  protected override spawnCursorSampler(_binaryPath: string, _args: string[]): ChildProcess {
    const child = new FakeSamplerChild(null)
    this.cursorSamplerChildren.push(child)
    return child as unknown as ChildProcess
  }
}

// A 2048-byte buffer carrying an `ftyp`/`moov` marker so the recording-finalize
// gate (finalizeRecording) validates it. The mocked ffmpeg below writes this to
// the finalize output; single-window stop() fakes write it as the raw source.
const VALID_MP4 = (() => {
  const b = Buffer.alloc(2048)
  b.write('ftypmoov', 0, 'ascii')
  return b
})()

/**
 * Routes finalize's ffprobe/ffmpeg through a mock: ffprobe reports an h264 +
 * yuv420p stream (so finalize takes the lossless remux fast-path) with the
 * given duration, and ffmpeg writes VALID_MP4 to the output. Lets the daemon
 * recording tests exercise the real stopRecording → finalize → addArtifact path
 * without depending on host ffmpeg or a real capture.
 */
function installFinalizeRunner(durationSec = 1.25): void {
  setProcessRunner((cmd, args) => {
    const target = args[args.length - 1]
    if (cmd === 'ffprobe') {
      return {
        kill: () => {},
        waitForExit: () => Promise.resolve(0),
        stdout: () => Promise.resolve(JSON.stringify({
          streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 800, height: 600, duration: String(durationSec) }],
          format: { duration: String(durationSec) },
        })),
        stderr: () => Promise.resolve(''),
      }
    }
    return {
      kill: () => {},
      waitForExit: () => {
        writeFileSync(target, VALID_MP4)
        return Promise.resolve(0)
      },
      stderr: () => Promise.resolve(''),
    }
  })
}

describe('daemon core', () => {
  beforeEach(() => {
    installFinalizeRunner()
  })

  afterEach(() => {
    resetProcessRunner()
  })

  it('reports versioned daemon health with structured permission states', async () => {
    const core = createDaemonCore({
      startedAt: 123,
      daemonVersion: '0.3.2',
      healthProbe: {
        aquaSessionProbe: async () => true,
        windowServerProbe: async () => ({ connected: true }),
      },
    })

    const health = await core.health({ includePermissions: true })

    expect(health).toMatchObject({
      ok: true,
      apiVersion: API_VERSION,
      daemonVersion: expect.any(String),
      startedAt: 123,
      aquaSession: true,
      windowServer: { connected: true },
    })
    expect(health.permissions).toHaveLength(4)
    expect(health.permissions).toEqual([
      expect.objectContaining({
        permission: 'accessibility',
        state: expect.stringMatching(/^(granted|denied|not-determined|restricted|unsupported|unknown)$/),
        requiredFor: expect.any(Array),
        canPrompt: expect.any(Boolean),
        lastCheckedAt: expect.any(Number),
      }),
      expect.objectContaining({
        permission: 'screen-recording',
        state: expect.stringMatching(/^(granted|denied|not-determined|restricted|unsupported|unknown)$/),
        requiredFor: expect.any(Array),
        canPrompt: expect.any(Boolean),
        lastCheckedAt: expect.any(Number),
      }),
      expect.objectContaining({
        permission: 'automation',
        state: expect.stringMatching(/^(granted|denied|not-determined|restricted|unsupported|unknown)$/),
        requiredFor: expect.any(Array),
        canPrompt: expect.any(Boolean),
        lastCheckedAt: expect.any(Number),
      }),
      expect.objectContaining({
        permission: 'developer-tools',
        state: expect.stringMatching(/^(granted|denied|not-determined|restricted|unsupported|unknown)$/),
        requiredFor: expect.any(Array),
        canPrompt: expect.any(Boolean),
        lastCheckedAt: expect.any(Number),
      }),
    ])
  })

  it('delegates empty session listing through the shared context', async () => {
    const core = createDaemonCore()

    await expect(core.listSessions()).resolves.toEqual({ sessions: [] })
  })

  it('records composite video through the daemon worker with keep-awake bracketing', async () => {
    const keepAwake = new FakeKeepAwake()
    const core = createDaemonCore({
      keepAwake,
      recordCompositeWorker: async () => {
        expect(keepAwake.activeRecordings).toBe(1)
        expect(keepAwake.engaged).toBe(true)
        return {
          ok: true,
          output: '/tmp/out.mp4',
          command: '/tmp/spectra-composite-capture --out /tmp/out.mp4',
          blackFrameGuard: {
            sampleCount: 3,
            meanLuma: 72,
            allBlack: false,
            skipped: false,
          },
          warnings: [],
        }
      },
    })

    const result = await core.recordComposite({
      appA: 'Codex',
      appB: 'Chrome',
      outPath: '/tmp/out.mp4',
    })

    expect(result).toMatchObject({
      ok: true,
      output: '/tmp/out.mp4',
      blackFrameGuard: { meanLuma: 72, allBlack: false },
    })
    expect(keepAwake.events[0]).toMatch(/^start:composite-/)
    expect(keepAwake.events[1]).toMatch(/^stop:composite-/)
    expect(keepAwake.activeRecordings).toBe(0)
  })

  it('stops daemon keep-awake when the composite worker fails', async () => {
    const keepAwake = new FakeKeepAwake()
    const core = createDaemonCore({
      keepAwake,
      recordCompositeWorker: async () => {
        throw new Error('worker failed')
      },
    })

    await expect(core.recordComposite({
      appA: 'Codex',
      appB: 'Chrome',
      outPath: '/tmp/out.mp4',
    })).rejects.toMatchObject({
      code: 'recording_failed',
      status: 500,
    })
    expect(keepAwake.events).toHaveLength(2)
    expect(keepAwake.activeRecordings).toBe(0)
  })

  it('returns typed composite permission failures with keep-awake bracketing', async () => {
    const keepAwake = new FakeKeepAwake()
    const core = createDaemonCore({
      keepAwake,
      recordCompositeWorker: async () => ({
        ok: false,
        command: '/tmp/spectra-composite-capture --out /tmp/out.mp4',
        blackFrameGuard: {
          sampleCount: 0,
          meanLuma: null,
          allBlack: false,
          skipped: true,
        },
        warnings: [],
        error: 'Screen Recording not granted to Spectra.',
        errorCode: 'permission_denied',
        hint: 'Enable Screen Recording for the signed Spectra daemon helper in System Settings > Privacy & Security > Screen Recording, then retry.',
        details: {
          nativeCode: 'screen_recording_not_granted',
          permission: 'screen-recording',
        },
        retryable: false,
      }),
    })

    const result = await core.recordComposite({
      appA: 'Codex',
      appB: 'Chrome',
      outPath: '/tmp/out.mp4',
    })

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'permission_denied',
      error: 'Screen Recording not granted to Spectra.',
      details: {
        nativeCode: 'screen_recording_not_granted',
        permission: 'screen-recording',
      },
    })
    expect(keepAwake.events[0]).toMatch(/^start:composite-/)
    expect(keepAwake.events[1]).toMatch(/^stop:composite-/)
    expect(keepAwake.activeRecordings).toBe(0)
  })

  it('starts and stops single-window recordings through the daemon registry', async () => {
    const repoPath = mkdtempSync(join('/private/tmp', 'spectra-recording-test-'))
    const keepAwake = new FakeKeepAwake()
    const ctx = createContext()
    const events: DaemonEvent[] = []
    const session = await ctx.sessions.create({
      platform: 'macos',
      target: { appName: 'TextEdit' },
      repoPath,
    })
    const calls: string[] = []
    const core = createDaemonCore({
      context: ctx,
      keepAwake,
      eventSink: (event) => events.push(event),
      windowListProvider: async () => [{
        windowId: 42,
        appName: 'TextEdit',
        bundleIdentifier: 'com.apple.TextEdit',
        processId: 123,
        title: 'Notes',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        onScreen: true,
        active: true,
        layer: 0,
      }],
      singleWindowRecordingRunner: async (input: any) => {
        calls.push(`start:${input.recordingId}:${input.app}:${input.outPath}`)
        return {
          pid: 999,
          started: {
            recordingId: input.recordingId,
            path: input.outPath,
            startedAt: Date.now(),
            fps: input.fps,
            codec: input.codec,
            bitrate: input.bitrate,
            width: 800,
            height: 600,
          },
          stop: async () => {
            calls.push(`stop:${input.recordingId}`)
            writeFileSync(input.outPath, VALID_MP4)
            return {
              recordingId: input.recordingId,
              path: input.outPath,
              format: 'mp4',
              durationMs: 1250,
              sizeBytes: 2048,
              codec: input.codec,
              fps: input.fps,
              width: 800,
              height: 600,
              droppedFrames: 0,
            }
          },
          abort: async () => {
            calls.push(`abort:${input.recordingId}`)
          },
        }
      },
    })

    try {
      const started = await core.startRecording({ sessionId: session.id, fps: 30, codec: 'h264', bitrate: '4M' })
      expect(started).toMatchObject({
        recordingId: expect.stringMatching(/^recording-/),
        fps: 30,
        codec: 'h264',
        bitrate: '4M',
      })
      expect(ctx.sessions.getRun(session.id)?.recording).toMatchObject({
        state: 'recording',
        recordingId: started.recordingId,
        width: 800,
        height: 600,
      })

      const stopped = await core.stopRecording({ sessionId: session.id })
      expect(stopped).toMatchObject({
        recordingId: started.recordingId,
        path: expect.stringContaining(`${started.recordingId}.mp4`),
        durationMs: 1250,
        sizeBytes: 2048,
        alreadyStopped: false,
      })
      expect(ctx.sessions.getRun(session.id)?.recording).toMatchObject({
        state: 'saved',
        recordingId: started.recordingId,
        durationMs: 1250,
        sizeBytes: 2048,
      })
      expect(ctx.sessions.getRun(session.id)?.artifacts).toEqual([
        expect.objectContaining({ type: 'video', path: stopped.path }),
      ])
      expect(calls).toEqual([
        expect.stringMatching(/^start:recording-/),
        expect.stringMatching(/^stop:recording-/),
      ])
      expect(keepAwake.activeRecordings).toBe(0)
      expect(events.map((event) => event.type)).toEqual([
        'recording.status',
        'recording.status',
        'artifact.added',
      ])
      expect(events[0]).toMatchObject({
        type: 'recording.status',
        sessionId: session.id,
        data: { state: 'recording', recordingId: started.recordingId, sessionId: session.id },
      })
      expect(events[1]).toMatchObject({
        type: 'recording.status',
        sessionId: session.id,
        data: { state: 'saved', recordingId: started.recordingId, sessionId: session.id },
      })
      expect(events[2]).toMatchObject({
        type: 'artifact.added',
        sessionId: session.id,
        data: { type: 'video', path: stopped.path },
      })

      await expect(core.stopRecording({ sessionId: session.id })).resolves.toMatchObject({
        alreadyStopped: true,
      })
    } finally {
      await core.close()
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('marks a stub recording failed, preserves the raw, and registers no artifact', async () => {
    const repoPath = mkdtempSync(join('/private/tmp', 'spectra-recording-stub-'))
    const ctx = createContext()
    const events: DaemonEvent[] = []
    const session = await ctx.sessions.create({
      platform: 'macos',
      target: { appName: 'TextEdit' },
      repoPath,
    })
    const core = createDaemonCore({
      context: ctx,
      eventSink: (event) => events.push(event),
      windowListProvider: async () => [{
        windowId: 42,
        appName: 'TextEdit',
        bundleIdentifier: 'com.apple.TextEdit',
        processId: 123,
        title: 'Notes',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        onScreen: true,
        active: true,
        layer: 0,
      }],
      singleWindowRecordingRunner: async (input: any) => ({
        pid: 999,
        started: {
          recordingId: input.recordingId,
          path: input.outPath,
          startedAt: Date.now(),
          fps: input.fps,
          codec: input.codec,
          bitrate: input.bitrate,
          width: 800,
          height: 600,
        },
        stop: async () => {
          writeFileSync(input.outPath, 'video')
          return { path: input.outPath, format: 'mp4', durationMs: 1 }
        },
        abort: async () => {},
      }),
    })

    try {
      await core.startRecording({ sessionId: session.id })
      await expect(core.stopRecording({ sessionId: session.id })).rejects.toMatchObject({
        code: 'recording_failed',
        retryable: false,
      })

      const run = ctx.sessions.getRun(session.id)
      expect(run?.recording).toMatchObject({
        state: 'failed',
        rawPath: expect.stringContaining('.raw.mp4'),
        error: expect.stringContaining('produced a stub'),
      })
      expect(existsSync(run?.recording?.rawPath ?? '')).toBe(true)
      expect(run?.artifacts).toEqual([])
      expect(events.map((event) => event.type)).toEqual([
        'recording.status',
        'recording.status',
      ])
    } finally {
      await core.close()
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('does not spawn a cursor sampler or add cursor telemetry fields when captureCursor is off', async () => {
    const repoPath = mkdtempSync(join('/private/tmp', 'spectra-recording-no-cursor-'))
    const keepAwake = new FakeKeepAwake()
    const ctx = createContext()
    const events: DaemonEvent[] = []
    const session = await ctx.sessions.create({
      platform: 'macos',
      target: { appName: 'TextEdit' },
      repoPath,
    })
    const core = new CursorSamplerTestCore({
      context: ctx,
      keepAwake,
      eventSink: (event) => events.push(event),
      windowListProvider: async () => [{
        windowId: 42,
        appName: 'TextEdit',
        bundleIdentifier: 'com.apple.TextEdit',
        processId: 123,
        title: 'Notes',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        onScreen: true,
        active: true,
        layer: 0,
      }],
      singleWindowRecordingRunner: async (input: any) => ({
        pid: 999,
        started: {
          recordingId: input.recordingId,
          path: input.outPath,
          startedAt: Date.now(),
          fps: input.fps,
          codec: input.codec,
          bitrate: input.bitrate,
          width: 800,
          height: 600,
        },
        stop: async () => {
          writeFileSync(input.outPath, VALID_MP4)
          return {
            recordingId: input.recordingId,
            path: input.outPath,
            format: 'mp4',
            durationMs: 1250,
            sizeBytes: 2048,
            codec: input.codec,
            fps: input.fps,
            width: 800,
            height: 600,
            droppedFrames: 0,
          }
        },
        abort: async () => {},
      }),
    })

    try {
      const started = await core.startRecording({ sessionId: session.id, fps: 30, codec: 'h264', bitrate: '4M' })
      const stopped = await core.stopRecording({ sessionId: session.id })
      const run = ctx.sessions.getRun(session.id)
      const artifact = run?.artifacts[0]
      const artifactEvent = events.find((event) => event.type === 'artifact.added')
      const artifactEventData = artifactEvent?.data as { metadata?: Record<string, unknown> } | undefined

      expect(core.cursorSamplerArgs).toEqual([])
      expect(Object.keys(stopped).sort()).toEqual([
        'alreadyStopped',
        'codec',
        'droppedFrames',
        'durationMs',
        'format',
        'fps',
        'height',
        'path',
        'preset',
        'recordingId',
        'sizeBytes',
        'width',
      ].sort())
      expect(stopped).toMatchObject({
        recordingId: started.recordingId,
        path: expect.stringContaining(`${started.recordingId}.mp4`),
        alreadyStopped: false,
      })
      expect(run?.recording?.cursorTelemetryPath).toBeUndefined()
      expect(artifact?.metadata).not.toHaveProperty('cursorTelemetryPath')
      expect(artifactEventData?.metadata).not.toHaveProperty('cursorTelemetryPath')
      expect(keepAwake.activeRecordings).toBe(0)
    } finally {
      await core.close()
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('spawns the cursor sampler and attaches telemetry when captureCursor is on', async () => {
    const repoPath = mkdtempSync(join('/private/tmp', 'spectra-recording-cursor-'))
    const keepAwake = new FakeKeepAwake()
    const ctx = createContext()
    const events: DaemonEvent[] = []
    const session = await ctx.sessions.create({
      platform: 'macos',
      target: { appName: 'TextEdit' },
      repoPath,
    })
    const core = new CursorSamplerTestCore({
      context: ctx,
      keepAwake,
      eventSink: (event) => events.push(event),
      windowListProvider: async () => [{
        windowId: 42,
        appName: 'TextEdit',
        bundleIdentifier: 'com.apple.TextEdit',
        processId: 123,
        title: 'Notes',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        onScreen: true,
        active: true,
        layer: 0,
      }],
      singleWindowRecordingRunner: async (input: any) => ({
        pid: 999,
        started: {
          recordingId: input.recordingId,
          path: input.outPath,
          startedAt: Date.now(),
          fps: input.fps,
          codec: input.codec,
          bitrate: input.bitrate,
          width: 800,
          height: 600,
        },
        stop: async () => {
          writeFileSync(input.outPath, VALID_MP4)
          return {
            recordingId: input.recordingId,
            path: input.outPath,
            format: 'mp4',
            durationMs: 1250,
            sizeBytes: 2048,
            codec: input.codec,
            fps: input.fps,
            width: 800,
            height: 600,
            droppedFrames: 0,
          }
        },
        abort: async () => {},
      }),
    })

    try {
      const started = await core.startRecording({
        sessionId: session.id,
        fps: 30,
        codec: 'h264',
        bitrate: '4M',
        captureCursor: true,
      })
      const cursorTelemetryPath = join(ctx.sessions.sessionDir(session.id), `${started.recordingId}.cursor.json`)
      writeFileSync(cursorTelemetryPath, JSON.stringify({
        durationMs: 100,
        samples: [{ tMs: 0, cx: 10, cy: 20 }],
        clicks: [],
      }))

      await core.stopRecording({ sessionId: session.id })
      const run = ctx.sessions.getRun(session.id)
      const artifact = run?.artifacts[0]
      const artifactEvent = events.find((event) => event.type === 'artifact.added')

      expect(core.cursorSamplerArgs).toEqual([[
        '--duration', '300',
        '--fps', '30',
        '--out', cursorTelemetryPath,
      ]])
      expect(core.cursorSamplerBinaries).toEqual(['/fake/path/spectra-cursor-sampler'])
      expect(core.cursorSamplerChildren[0].killSignals).toEqual(['SIGTERM'])
      expect(run?.recording?.cursorTelemetryPath).toBe(cursorTelemetryPath)
      expect(artifact?.metadata).toMatchObject({ cursorTelemetryPath })
      expect(artifactEvent).toMatchObject({
        type: 'artifact.added',
        sessionId: session.id,
        data: {
          metadata: expect.objectContaining({ cursorTelemetryPath }),
        },
      })
      expect(keepAwake.activeRecordings).toBe(0)
    } finally {
      await core.close()
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('f2: warns and skips the spawn when the cursor sampler binary cannot be (re)built', async () => {
    const priorHelperMode = process.env.SPECTRA_HELPER_MODE
    process.env.SPECTRA_HELPER_MODE = 'development'
    const repoPath = mkdtempSync(join('/private/tmp', 'spectra-recording-cursor-nobuild-'))
    const keepAwake = new FakeKeepAwake()
    const ctx = createContext()
    const session = await ctx.sessions.create({
      platform: 'macos',
      target: { appName: 'TextEdit' },
      repoPath,
    })
    const core = new EnsureCursorSamplerBinaryFailsTestCore({
      context: ctx,
      keepAwake,
      windowListProvider: async () => [{
        windowId: 42,
        appName: 'TextEdit',
        bundleIdentifier: 'com.apple.TextEdit',
        processId: 123,
        title: 'Notes',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        onScreen: true,
        active: true,
        layer: 0,
      }],
      singleWindowRecordingRunner: async (input: any) => ({
        pid: 999,
        started: {
          recordingId: input.recordingId,
          path: input.outPath,
          startedAt: Date.now(),
          fps: input.fps,
          codec: input.codec,
          bitrate: input.bitrate,
          width: 800,
          height: 600,
        },
        stop: async () => {
          writeFileSync(input.outPath, VALID_MP4)
          return {
            recordingId: input.recordingId,
            path: input.outPath,
            format: 'mp4',
            durationMs: 1250,
            sizeBytes: 2048,
            codec: input.codec,
            fps: input.fps,
            width: 800,
            height: 600,
            droppedFrames: 0,
          }
        },
        abort: async () => {},
      }),
    })

    try {
      await core.startRecording({ sessionId: session.id, fps: 30, codec: 'h264', bitrate: '4M', captureCursor: true })
      await core.stopRecording({ sessionId: session.id })
      const run = ctx.sessions.getRun(session.id)
      const artifact = run?.artifacts[0]

      // ensureCursorSamplerBinary() threw, so the spawn was skipped entirely.
      expect(core.cursorSamplerArgs).toEqual([])
      expect(run?.recording?.cursorTelemetryPath).toBeUndefined()
      expect(artifact?.metadata).toMatchObject({
        warnings: expect.arrayContaining([
          expect.stringContaining('cursor telemetry requested but the sampler produced no output'),
        ]),
      })

      process.env.SPECTRA_HELPER_MODE = 'bundle'
      await expect(core.startRecording({
        sessionId: session.id,
        fps: 30,
        codec: 'h264',
        bitrate: '4M',
        captureCursor: true,
      })).rejects.toThrow('cursor sampler unavailable')
      expect(keepAwake.activeRecordings).toBe(0)
    } finally {
      await core.close()
      rmSync(repoPath, { recursive: true, force: true })
      if (priorHelperMode === undefined) delete process.env.SPECTRA_HELPER_MODE
      else process.env.SPECTRA_HELPER_MODE = priorHelperMode
    }
  })

  it('f2/f3: warns and stops fast when the cursor sampler spawn produces a pidless/crashing child', async () => {
    const repoPath = mkdtempSync(join('/private/tmp', 'spectra-recording-cursor-crash-'))
    const keepAwake = new FakeKeepAwake()
    const ctx = createContext()
    const session = await ctx.sessions.create({
      platform: 'macos',
      target: { appName: 'TextEdit' },
      repoPath,
    })
    const core = new PidlessCursorSamplerTestCore({
      context: ctx,
      keepAwake,
      windowListProvider: async () => [{
        windowId: 42,
        appName: 'TextEdit',
        bundleIdentifier: 'com.apple.TextEdit',
        processId: 123,
        title: 'Notes',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        onScreen: true,
        active: true,
        layer: 0,
      }],
      singleWindowRecordingRunner: async (input: any) => ({
        pid: 999,
        started: {
          recordingId: input.recordingId,
          path: input.outPath,
          startedAt: Date.now(),
          fps: input.fps,
          codec: input.codec,
          bitrate: input.bitrate,
          width: 800,
          height: 600,
        },
        stop: async () => {
          writeFileSync(input.outPath, VALID_MP4)
          return {
            recordingId: input.recordingId,
            path: input.outPath,
            format: 'mp4',
            durationMs: 1250,
            sizeBytes: 2048,
            codec: input.codec,
            fps: input.fps,
            width: 800,
            height: 600,
            droppedFrames: 0,
          }
        },
        abort: async () => {},
      }),
    })

    try {
      await core.startRecording({ sessionId: session.id, fps: 30, codec: 'h264', bitrate: '4M', captureCursor: true })
      // No telemetry file is ever written — simulates a sampler that crashed
      // immediately after a pidless/failed spawn.
      const stopStartedAt = Date.now()
      await core.stopRecording({ sessionId: session.id })
      const stopElapsedMs = Date.now() - stopStartedAt
      const run = ctx.sessions.getRun(session.id)
      const artifact = run?.artifacts[0]

      // f3: pidless child — stopCursorSampler short-circuits, never signals it.
      expect(core.cursorSamplerChildren[0].killSignals).toEqual([])
      expect(stopElapsedMs).toBeLessThan(500)
      // f2: telemetry never showed up — silent failure is now a surfaced warning.
      expect(run?.recording?.cursorTelemetryPath).toBeUndefined()
      expect(artifact?.metadata).toMatchObject({
        warnings: expect.arrayContaining([
          expect.stringContaining('cursor telemetry requested but the sampler produced no output'),
        ]),
      })
    } finally {
      await core.close()
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('emits recording and artifact events around synchronous composite recording', async () => {
    const repoPath = mkdtempSync(join('/private/tmp', 'spectra-composite-events-'))
    const ctx = createContext()
    const events: DaemonEvent[] = []
    const session = await ctx.sessions.create({
      platform: 'macos',
      target: { appName: 'TextEdit' },
      repoPath,
    })
    const core = createDaemonCore({
      context: ctx,
      eventSink: (event) => events.push(event),
      recordCompositeWorker: async () => ({
        ok: true,
        output: '/tmp/composite.mp4',
        command: '/tmp/spectra-composite-capture --out /tmp/composite.mp4',
        blackFrameGuard: {
          sampleCount: 2,
          meanLuma: 70,
          allBlack: false,
          skipped: false,
        },
        warnings: [],
      }),
    })

    try {
      const result = await core.recordComposite({
        appA: 'TextEdit',
        appB: 'Terminal',
        outPath: '/tmp/composite.mp4',
        sessionId: session.id,
      })

      expect(result).toMatchObject({ ok: true, artifactId: expect.any(String) })
      expect(events.map((event) => event.type)).toEqual([
        'recording.status',
        'recording.status',
        'artifact.added',
      ])
      expect(events[0]).toMatchObject({
        type: 'recording.status',
        sessionId: session.id,
        data: { state: 'recording', sessionId: session.id },
      })
      expect(events[1]).toMatchObject({
        type: 'recording.status',
        sessionId: session.id,
        data: { state: 'saved', sessionId: session.id, path: '/tmp/composite.mp4' },
      })
      expect(events[2]).toMatchObject({
        type: 'artifact.added',
        sessionId: session.id,
        data: { type: 'video', path: '/tmp/composite.mp4' },
      })
    } finally {
      await core.close()
      rmSync(repoPath, { recursive: true, force: true })
    }
  })
})

describe('daemon envelopes', () => {
  it('wraps successful API results with apiVersion and request identity', () => {
    const envelope = successEnvelope(
      {
        apiVersion: API_VERSION,
        requestId: 'req-1',
        operation: 'listSessions',
      },
      { sessions: [] },
      { timestamp: 456, deliveryPath: 'test' },
    )

    expect(envelope).toEqual({
      apiVersion: API_VERSION,
      requestId: 'req-1',
      ok: true,
      result: { sessions: [] },
      timestamp: 456,
      caller: undefined,
      deliveryPath: 'test',
    })
  })

  it('builds SSE frames from daemon events', () => {
    const envelope = eventEnvelope(
      {
        type: 'session.closed',
        sessionId: 'sess-1',
        data: { sessionId: 'sess-1' },
      },
      { eventId: 'evt-1', timestamp: 789 },
    )
    const frame = sseFrame(envelope, 1000)

    expect(frame).toEqual({
      event: 'session.closed',
      id: 'evt-1',
      data: envelope,
      retry: 1000,
    })
    expect(formatSseFrame(frame)).toContain('event: session.closed')
    expect(formatSseFrame(frame)).toContain('"sessionId":"sess-1"')
  })
})
