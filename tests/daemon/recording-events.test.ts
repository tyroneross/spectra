// Tests for the SSE event EMISSION path (previously dormant: no operation ever
// called the event sink). These exercise the real ops (recordComposite + the R2
// startRecording/stopRecording pair) through injected fakes — no native binary,
// no Chrome — and assert the operations actually emit recording.status +
// artifact.added through the eventSink. Includes a mutation/gating check: with no
// session attached, emission must NOT fire (proves the events are real, not spurious).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDaemonCore } from '../../src/daemon/core.js'
import type { DaemonEvent } from '../../src/contract/wire.js'
import type { ToolContext } from '../../src/mcp/context.js'
import type { KeepAwakeController } from '../../src/daemon/keep-awake.js'

let tmpRoot: string
beforeEach(() => { tmpRoot = mkdtempSync(join('/private/tmp', 'spectra-rec-events-')) })
afterEach(() => { rmSync(tmpRoot, { recursive: true, force: true }) })

class FakeKeepAwake implements KeepAwakeController {
  private readonly recordings = new Set<string>()
  get activeRecordings(): number { return this.recordings.size }
  get engaged(): boolean { return this.recordings.size > 0 }
  async recordingStarted(id: string): Promise<void> { this.recordings.add(id) }
  async recordingStopped(id: string): Promise<void> { this.recordings.delete(id) }
  async close(): Promise<void> { this.recordings.clear() }
}

/** Minimal in-memory ToolContext: a session store that needs no driver/native. */
function fakeContext(session?: { id: string }): ToolContext {
  const sessions = {
    get: (id: string) =>
      session && id === session.id
        ? { id, platform: 'macos', target: { appName: 'TestApp' }, createdAt: Date.now() }
        : undefined,
    sessionDir: (id: string) => join(tmpRoot, id),
    setRecordingStatus: async (id: string, status: Record<string, unknown>) => ({ ...status, sessionId: id }),
    addArtifact: async (id: string, art: Record<string, unknown>) => ({ ...art, id: 'art-1', sessionId: id }),
  }
  return { sessions } as unknown as ToolContext
}

const recTypes = (events: DaemonEvent[]) => events.map((e) => e.type)
const recStates = (events: DaemonEvent[]) =>
  events.filter((e) => e.type === 'recording.status').map((e) => (e as unknown as { data: { state: string } }).data.state)

describe('SSE emission — recordComposite', () => {
  it('emits recording.status(recording→saved) + artifact.added when a session exists', async () => {
    const events: DaemonEvent[] = []
    writeFileSync(join(tmpRoot, 'out.mp4'), 'x')
    const core = createDaemonCore({
      context: fakeContext({ id: 'sess-1' }),
      keepAwake: new FakeKeepAwake(),
      recordCompositeWorker: (async () => ({
        ok: true,
        output: join(tmpRoot, 'out.mp4'),
        command: 'fake',
        blackFrameGuard: { sampleCount: 3, meanLuma: 72, allBlack: false, skipped: false },
        warnings: [],
      })) as never,
      eventSink: (e) => events.push(e),
    })

    await core.recordComposite({ appA: 'A', appB: 'B', outPath: join(tmpRoot, 'out.mp4'), durationSeconds: 5, fps: 60, sessionId: 'sess-1' } as never)

    expect(recTypes(events)).toEqual(['recording.status', 'recording.status', 'artifact.added'])
    expect(recStates(events)).toEqual(['recording', 'saved'])
  })

  it('does NOT emit when no session is attached (emission is gated, not spurious)', async () => {
    const events: DaemonEvent[] = []
    writeFileSync(join(tmpRoot, 'out.mp4'), 'x')
    const core = createDaemonCore({
      context: fakeContext(undefined),
      keepAwake: new FakeKeepAwake(),
      recordCompositeWorker: (async () => ({
        ok: true, output: join(tmpRoot, 'out.mp4'), command: 'fake',
        blackFrameGuard: { sampleCount: 3, meanLuma: 72, allBlack: false, skipped: false }, warnings: [],
      })) as never,
      eventSink: (e) => events.push(e),
    })

    await core.recordComposite({ appA: 'A', appB: 'B', outPath: join(tmpRoot, 'out.mp4'), fps: 60 } as never)

    expect(events).toEqual([])
  })

  it('emits recording.status(failed) and no artifact when the worker reports failure', async () => {
    const events: DaemonEvent[] = []
    const core = createDaemonCore({
      context: fakeContext({ id: 'sess-1' }),
      keepAwake: new FakeKeepAwake(),
      recordCompositeWorker: (async () => ({
        ok: false, output: undefined, command: 'fake', error: 'boom',
        blackFrameGuard: { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true }, warnings: [],
      })) as never,
      eventSink: (e) => events.push(e),
    })

    await core.recordComposite({ appA: 'A', appB: 'B', outPath: join(tmpRoot, 'out.mp4'), fps: 60, sessionId: 'sess-1' } as never)

    expect(recTypes(events)).toEqual(['recording.status', 'recording.status'])
    expect(recStates(events)).toEqual(['recording', 'failed'])
  })
})

describe('SSE emission — R2 startRecording/stopRecording', () => {
  it('runs the real ops and emits recording.status(recording) on start, recording.status(saved) + artifact.added on stop', async () => {
    const events: DaemonEvent[] = []
    const recPath = join(tmpRoot, 'rec.mp4')
    const fakeHandle = {
      pid: 4242,
      started: { width: 800, height: 600 },
      stop: async () => {
        writeFileSync(recPath, 'x')
        return { path: recPath, format: 'mp4', durationMs: 1234, codec: 'h264', fps: 60, width: 800, height: 600 }
      },
      abort: async () => {},
    }
    const core = createDaemonCore({
      context: fakeContext({ id: 'sess-1' }),
      keepAwake: new FakeKeepAwake(),
      windowListProvider: async () =>
        [{ appName: 'TestApp', bundleIdentifier: 'com.test', onScreen: true, layer: 0, width: 800, height: 600, title: 'TestApp Window' }] as never,
      singleWindowRecordingRunner: (async () => fakeHandle) as never,
      eventSink: (e) => events.push(e),
    })

    const started = await core.startRecording({ sessionId: 'sess-1' } as never)
    expect(started.recordingId).toBeTruthy()
    expect(events.some((e) => e.type === 'recording.status' && (e as unknown as { data: { state: string } }).data.state === 'recording')).toBe(true)

    const stopped = await core.stopRecording({ sessionId: 'sess-1' } as never)
    expect((stopped as { alreadyStopped?: boolean }).alreadyStopped).toBe(false)
    expect(events.some((e) => e.type === 'artifact.added')).toBe(true)
    expect(events.some((e) => e.type === 'recording.status' && (e as unknown as { data: { state: string } }).data.state === 'saved')).toBe(true)
  })

  it('stopRecording with no active recording returns alreadyStopped and emits nothing', async () => {
    const events: DaemonEvent[] = []
    const core = createDaemonCore({
      context: fakeContext({ id: 'sess-1' }),
      keepAwake: new FakeKeepAwake(),
      eventSink: (e) => events.push(e),
    })
    const stopped = await core.stopRecording({ sessionId: 'sess-1' } as never)
    expect((stopped as { alreadyStopped?: boolean }).alreadyStopped).toBe(true)
    expect(events).toEqual([])
  })
})
