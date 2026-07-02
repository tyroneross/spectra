// tests/conformance/lib/fakes.ts
//
// M2B — native-independence seam. The conformance oracle checks CONTRACT
// conformance (request-accept + response/error SHAPE), not that capture
// physically works (per docs/plans/native-swift-migration.md M2B). These
// fakes plug into the daemon's EXISTING injectable seams (CoreApiImplementation
// constructor options + its `protected` AX-bridge/vision-fallback factory
// methods) so the real TS daemon — real server.ts, real core-impl.ts business
// logic, real session/library/security code — runs headless, with no
// ScreenCaptureKit, no Accessibility permission, no ffmpeg binary, and no
// booted simulator required.
//
// Nothing here edits src/daemon/** or native/** (both read-only per the M2B
// ownership boundary) — every seam used below is a pre-existing, intentional
// extension point (see the "Overridable seam" comments in core-impl.ts).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { CoreApiImplementation, type CoreApiImplementationOptions } from '../../../src/daemon/core-impl.js'
import type { AxBridgePort, RawAxSnapshot, RawActResult } from '../../../src/computer-use/port.js'
import type { AxTarget } from '../../../src/computer-use/types.js'
import type { VisionFallback } from '../../../src/computer-use/vision-fallback.js'
import type { Driver, DriverTarget, Snapshot, ActResult, Element } from '../../../src/core/types.js'
import type { WindowRecord } from '../../../src/contract/core-api.js'
import type { RecordCompositeParams, RecordCompositeCompletedResult } from '../../../src/contract/core-api.js'

// A minimal, valid, statically-encoded 1x1 transparent PNG. Real enough for
// every code path that decodes/crops/re-encodes a "screenshot" (src/media/
// capture.ts's decodePng/cropImage/encodePng) without a real display.
export const FAKE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export function fakePngBuffer(): Buffer {
  return Buffer.from(FAKE_PNG_BASE64, 'base64')
}

function fakeElement(id: string): Element {
  return {
    id,
    role: 'button',
    label: `Fake Element ${id}`,
    value: null,
    enabled: true,
    focused: false,
    actions: ['click'],
    bounds: [0, 0, 100, 24],
    parent: null,
  }
}

export const FAKE_ELEMENT_ID = 'el-1'

// ─── Driver stub — backs snapshot/observe/act/step/llmStep/walkthrough/
// screenshot/analyze/discover for a pre-seeded session (no CDP, no AX, no
// simulator). Implements the same `Driver` interface every real driver
// (CdpDriver/NativeDriver/SimDriver) implements, so every tool handler in
// src/mcp/tools/* (which only ever calls `ctx.drivers.get(sessionId)`) is
// exercised through its REAL code path — only the bottom-most native I/O is
// faked.
export class FakeDriver implements Driver {
  connected = false
  actionsSeen: Array<{ elementId: string; action: string; value?: string }> = []

  async connect(_target: DriverTarget): Promise<void> {
    this.connected = true
  }

  async snapshot(): Promise<Snapshot> {
    return {
      url: 'https://fake.local/conformance',
      appName: 'Fake Conformance App',
      platform: 'web',
      elements: [fakeElement(FAKE_ELEMENT_ID), fakeElement('el-2')],
      timestamp: Date.now(),
      metadata: { elementCount: 2, stableAt: Date.now() },
    }
  }

  async act(elementId: string, action: import('../../../src/core/types.js').ActionType, value?: string): Promise<ActResult> {
    this.actionsSeen.push({ elementId, action, value })
    return { success: true, snapshot: await this.snapshot() }
  }

  async screenshot(): Promise<Buffer> {
    return fakePngBuffer()
  }

  async navigate(_url: string): Promise<void> {}

  async close(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.connected = false
  }
}

// ─── AX bridge stub — backs computerUse (snapshot/act/fill-form). Real
// bridge is native/computer-use/native-port.ts (shells a Swift AX helper);
// this is the same seam unit tests for ComputerUse already use (see
// src/computer-use/port.ts doc comment: "unit tests inject a fake AX
// snapshot").
export class FakeAxBridgePort implements AxBridgePort {
  async snapshotFocused(_target?: AxTarget): Promise<RawAxSnapshot> {
    return {
      window: { title: 'Fake Window', bounds: [0, 0, 400, 300] },
      elements: [
        {
          role: 'button',
          label: 'Fake Button',
          value: null,
          enabled: true,
          focused: false,
          actions: ['press'],
          bounds: [0, 0, 100, 24],
          path: [0],
        },
      ],
      nodeCount: 1,
      axStatus: 'ok',
      focusedWindowTitle: 'Fake Window',
    }
  }

  async act(): Promise<RawActResult> {
    return { success: true, value: 'fake-value' }
  }

  async key(): Promise<{ success: boolean; error?: string }> {
    return { success: true }
  }

  async clickAt(): Promise<{ success: boolean; error?: string }> {
    return { success: true }
  }

  async typeText(): Promise<{ success: boolean; error?: string }> {
    return { success: true }
  }

  async visionAvailable(): Promise<{ available: boolean; reason?: string }> {
    return { available: false, reason: 'conformance-stub: vision fallback disabled' }
  }

  async visionGround(): Promise<Array<{ label: string; bounds: [number, number, number, number]; confidence: number }>> {
    return []
  }

  async preflight(): Promise<{ trusted: boolean }> {
    return { trusted: true }
  }
}

// ─── listWindows / startRecording / recordComposite fakes ─────────────────

export async function fakeWindowListProvider(): Promise<WindowRecord[]> {
  return [
    {
      windowId: 1,
      appName: 'Fake Conformance App',
      bundleIdentifier: 'dev.spectra.conformance-fake',
      processId: 999999,
      title: 'Fake Window',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      onScreen: true,
      active: true,
      layer: 0,
    },
  ]
}

export function fakeSingleWindowRecordingRunner() {
  return async (_input: unknown) => {
    let stopped = false
    return {
      pid: 999999,
      started: { recordingId: 'fake', path: '/tmp/fake-conformance-recording.mp4', width: 800, height: 600 },
      async stop() {
        stopped = true
        return {
          path: '/tmp/fake-conformance-recording.mp4',
          format: 'mp4',
          durationMs: 1000,
          sizeBytes: 4096,
          codec: 'h264',
          fps: 60,
          width: 800,
          height: 600,
          droppedFrames: 0,
        }
      },
      async abort() {
        stopped = true
      },
      get stopped() {
        return stopped
      },
    }
  }
}

export async function fakeRecordCompositeWorker(
  params: RecordCompositeParams,
): Promise<RecordCompositeCompletedResult> {
  return {
    ok: true,
    command: `fake-composite-worker --a ${params.appA} --b ${params.appB}`,
    output: '/tmp/fake-conformance-composite.mp4',
    blackFrameGuard: { sampleCount: 1, meanLuma: 128, allBlack: false, skipped: false },
    warnings: [],
  }
}

// ─── ConformanceCoreApi — subclasses the REAL daemon core, overriding only
// the two protected native-bridge factory seams. Everything else (session
// lifecycle, library, terminal, demo dispatch, error mapping, event bus) is
// the unmodified production implementation.
//
// `mutateOp` is an opt-in, harness-owned response-shape mutation hook used
// ONLY by tests/conformance/mutation-check.ts to prove the oracle bites (M2B
// acceptance requirement (b)). It is never enabled by the conformance suite
// itself — default behavior is byte-for-byte the real daemon's response.
export interface ConformanceCoreApiOptions extends CoreApiImplementationOptions {
  mutateOp?: {
    operation: string
    mutate: (result: unknown) => unknown
  }
}

export class ConformanceCoreApi extends CoreApiImplementation {
  private readonly mutateOp?: ConformanceCoreApiOptions['mutateOp']

  constructor(options: ConformanceCoreApiOptions = {}) {
    super(options)
    this.mutateOp = options.mutateOp
  }

  protected override createAxBridgePort(): AxBridgePort {
    return new FakeAxBridgePort()
  }

  protected override async createVisionFallback(): Promise<VisionFallback | undefined> {
    return undefined
  }

  protected override ensureCursorSamplerBinary(): string {
    // Real binary would require a compiled+signed swiftc output. Throwing
    // here exercises the daemon's existing graceful-degradation path
    // (startRecording catches this and proceeds without a cursor sampler,
    // surfacing a warning instead of failing the recording).
    throw new Error('conformance-stub: cursor sampler binary intentionally unavailable')
  }

  // Generic per-operation mutation hook. Only applies when `mutateOp` names
  // the operation currently being dispatched. `dispatch` below is the single
  // seam every 30 operations flow through in server.ts (`api[operation]`),
  // so wrapping it here covers all ops without a 30-way switch.
  private async withMutation<T>(operation: string, run: () => Promise<T>): Promise<T> {
    const result = await run()
    if (this.mutateOp && this.mutateOp.operation === operation) {
      return this.mutateOp.mutate(result) as T
    }
    return result
  }

  override async health(...args: Parameters<CoreApiImplementation['health']>) {
    return this.withMutation('health', () => super.health(...args))
  }

  override async getSession(...args: Parameters<CoreApiImplementation['getSession']>) {
    return this.withMutation('getSession', () => super.getSession(...args))
  }

  // snapshot/startRecording/stopRecording/screenshot are wrapped so
  // mutation-check.ts can prove the oracle bites on CORE (session-dependent) ops'
  // SUCCESS shapes — not just health's. Before the D1 ordering fix these only
  // reached the error path.
  //
  // stopRecording + screenshot are mutation-proof again: their results are now
  // DISCRIMINATED UNIONS in core-api.ts (Completed|AlreadyStopped; Image|SoftError)
  // so the completed/image branches require their full field sets — a drop-field
  // mutation on the completed/image result matches NEITHER union member and is
  // caught. startRecording is single-success-path (required fields); getSession
  // requires `session`. All are red-before/green-after in mutation-check.
  override async snapshot(...args: Parameters<CoreApiImplementation['snapshot']>) {
    return this.withMutation('snapshot', () => super.snapshot(...args))
  }

  override async startRecording(...args: Parameters<CoreApiImplementation['startRecording']>) {
    return this.withMutation('startRecording', () => super.startRecording(...args))
  }

  override async stopRecording(...args: Parameters<CoreApiImplementation['stopRecording']>) {
    return this.withMutation('stopRecording', () => super.stopRecording(...args))
  }

  override async screenshot(...args: Parameters<CoreApiImplementation['screenshot']>) {
    return this.withMutation('screenshot', () => super.screenshot(...args))
  }
}
