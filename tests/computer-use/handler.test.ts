// tests/computer-use/handler.test.ts
//
// Daemon-handler-level coverage for CoreApiImplementation#computerUse. Unlike
// tests/computer-use/computer-use.test.ts (which exercises the ComputerUse
// orchestration class directly against a fake AxBridgePort), this suite
// exercises the *daemon handler* — proving the wiring between
// ComputerUseParams and the ComputerUse instance it constructs, via the
// `createAxBridgePort` override seam (see src/daemon/core-impl.ts).
//
// Covers:
//   (a) params.threshold actually reaches the ComputerUse instance and gates
//       needsVisionFallback (regression test for the dropped-threshold bug —
//       fails against pre-fix code, see comment below).
//   (b) an AX permission error maps to the daemon's permission_denied / 403
//       path instead of leaking a raw AxPermissionError.
//   (c) a STANDALONE `action:'act'` MCP call — no prior snapshot call in the
//       same instance — resolves against the focused window and dispatches
//       to the bridge. Regression test for the dead-act-path defect: the
//       daemon used to construct a brand-new ComputerUse per call, whose
//       cache was always empty, so `act` always reported matched:false /
//       needsVisionFallback:true regardless of the app. This test FAILS
//       against pre-fix computer-use.ts (see mutation-check note below).
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { CoreApiImplementation } from '../../src/daemon/core-impl.js'
import { DaemonApiError } from '../../src/daemon/errors.js'
import { AxPermissionError, type AxBridgePort, type RawActRequest, type RawActResult, type RawAxSnapshot, type RawClickAtRequest, type RawTypeTextRequest, type RawVisionAvailability, type RawVisionGrounding } from '../../src/computer-use/port.js'
import { NativeVisionFallback, type VisionFallback } from '../../src/computer-use/vision-fallback.js'
import type { AxNode } from '../../src/computer-use/types.js'
import type { ComputerUseActResult, ComputerUseSnapshotResult } from '../../src/contract/core-api.js'

function mkNode(label: string, path: number[] = [0]): AxNode {
  return {
    source: 'ax',
    role: 'AXButton',
    label,
    value: null,
    enabled: true,
    focused: false,
    actions: ['press'],
    bounds: [0, 0, 10, 10],
    path,
  }
}

/** Fake AX bridge: returns a fixed snapshot (2 nodes, axStatus 'ok') or throws. */
class FakeAxBridgePort implements AxBridgePort {
  acts: RawActRequest[] = []
  clicks: RawClickAtRequest[] = []
  typed: RawTypeTextRequest[] = []
  snapshotCalls = 0
  visionAvailability: RawVisionAvailability = { available: false }
  visionGroundings: RawVisionGrounding[] = []

  constructor(
    private readonly snapshot?: RawAxSnapshot,
    private readonly failWith?: Error,
  ) {}

  async snapshotFocused(): Promise<RawAxSnapshot> {
    this.snapshotCalls++
    if (this.failWith) throw this.failWith
    return this.snapshot!
  }

  async act(req: RawActRequest): Promise<RawActResult> {
    this.acts.push(req)
    return { success: true }
  }

  async key(): Promise<{ success: boolean }> {
    return { success: true }
  }

  async clickAt(req: RawClickAtRequest): Promise<{ success: boolean }> {
    this.clicks.push(req)
    return { success: true }
  }

  async typeText(req: RawTypeTextRequest): Promise<{ success: boolean }> {
    this.typed.push(req)
    return { success: true }
  }

  async visionAvailable(): Promise<RawVisionAvailability> {
    return this.visionAvailability
  }

  async visionGround(): Promise<RawVisionGrounding[]> {
    return this.visionGroundings
  }

  async preflight(): Promise<{ trusted: boolean }> {
    return { trusted: true }
  }
}

/** Test seam: injects a FakeAxBridgePort via the daemon's overridable factory,
 * exactly like production code injects the real NativeAxBridgePort. */
class HandlerTestCore extends CoreApiImplementation {
  constructor(private readonly port: AxBridgePort) {
    super()
  }

  protected override createAxBridgePort(): AxBridgePort {
    return this.port
  }

  protected override async createVisionFallback(): Promise<VisionFallback | undefined> {
    return undefined
  }
}

class HandlerVisionTestCore extends CoreApiImplementation {
  constructor(private readonly port: AxBridgePort) {
    super()
  }

  protected override createAxBridgePort(): AxBridgePort {
    return this.port
  }

  protected override async createVisionFallback(port: AxBridgePort): Promise<VisionFallback | undefined> {
    return new NativeVisionFallback(port, { available: true })
  }
}

describe('CoreApiImplementation#computerUse (daemon handler)', () => {
  const twoNodeSnapshot: RawAxSnapshot = {
    window: { title: 'Test Window', bounds: [0, 0, 800, 600] },
    elements: [mkNode('Save', [0, 0]), mkNode('Cancel', [0, 1])],
    nodeCount: 2,
    axStatus: 'ok',
    focusedWindowTitle: 'Test Window',
  }

  const emptySnapshot: RawAxSnapshot = {
    window: { title: 'Canvas', bounds: [0, 0, 800, 600] },
    elements: [],
    nodeCount: 0,
    axStatus: 'empty',
    focusedWindowTitle: 'Canvas',
  }

  it('maps params.threshold onto the ComputerUse vision-fallback gate (regression: silent no-op)', async () => {
    // 2 AX nodes present, axStatus 'ok'. A threshold of 5 must still trip
    // needsVisionFallback because 2 < 5 — but ONLY if params.threshold is
    // actually plumbed into ComputerUseOptions.visionFallbackThreshold.
    // Pre-fix, core-impl.ts dropped params.threshold entirely, so ComputerUse
    // always fell back to its default threshold of 1 (2 >= 1 → false) and
    // this assertion FAILS against the pre-fix handler.
    const core = new HandlerTestCore(new FakeAxBridgePort(twoNodeSnapshot))
    const result = (await core.computerUse({ action: 'snapshot', threshold: 5 })) as ComputerUseSnapshotResult

    expect(result.nodeCount).toBe(2)
    expect(result.needsVisionFallback).toBe(true)
    expect(result.fallbackReason).toBe('below-threshold')
  })

  it('does not gate the fallback when threshold is at or below the node count', async () => {
    const core = new HandlerTestCore(new FakeAxBridgePort(twoNodeSnapshot))
    const result = (await core.computerUse({ action: 'snapshot', threshold: 1 })) as ComputerUseSnapshotResult

    expect(result.needsVisionFallback).toBe(false)
  })

  it('falls back to the ComputerUse default threshold when params.threshold is omitted', async () => {
    const core = new HandlerTestCore(new FakeAxBridgePort(twoNodeSnapshot))
    const result = (await core.computerUse({ action: 'snapshot' })) as ComputerUseSnapshotResult

    expect(result.needsVisionFallback).toBe(false)
  })

  it('a standalone action:"act" call resolves against the focused window and dispatches to the bridge (dead-act-path regression)', async () => {
    // No prior 'snapshot' MCP call — this is the exact shape that was dead:
    // a bare `act` call is the FIRST thing this daemon handler sees.
    const port = new FakeAxBridgePort(twoNodeSnapshot)
    const core = new HandlerTestCore(port)

    const result = (await core.computerUse({
      action: 'act',
      op: { kind: 'click', label: 'Save' },
    })) as ComputerUseActResult

    expect(result.matched).toBe(true)
    expect(result.success).toBe(true)
    expect(result.needsVisionFallback).toBeFalsy()
    // Dispatched to the fake bridge's act(), not left unresolved.
    expect(port.acts).toHaveLength(1)
    expect(port.acts[0]?.action).toBe('press')
    expect(port.acts[0]?.elementPath).toEqual([0, 0])
    // Exactly one native snapshot round trip — the lazy self-snapshot, not zero.
    expect(port.snapshotCalls).toBe(1)
  })

  it('constructs and invokes the real NativeVisionFallback when AX is empty', async () => {
    const port = new FakeAxBridgePort(emptySnapshot)
    port.visionGroundings = [{ label: 'Play', bounds: [10, 20, 40, 20], confidence: 0.88 }]
    const core = new HandlerVisionTestCore(port)

    const result = (await core.computerUse({ action: 'snapshot' })) as ComputerUseSnapshotResult

    expect(result.axStatus).toBe('ok')
    expect(result.needsVisionFallback).toBe(false)
    expect(result.fallbackReason).toBe('vision-fallback-applied')
    expect(result.nodes).toMatchObject([
      { source: 'vision', role: 'AXButton', label: 'Play', bounds: [10, 20, 40, 20], confidence: 0.88 },
    ])
  })

  it('maps an AX permission error to the daemon permission_denied/403 path', async () => {
    const core = new HandlerTestCore(
      new FakeAxBridgePort(undefined, new AxPermissionError('Accessibility permission not granted')),
    )

    await expect(core.computerUse({ action: 'snapshot' })).rejects.toMatchObject({
      name: 'DaemonApiError',
      code: 'permission_denied',
      status: 403,
    })
  })

  it('the permission_denied error is a DaemonApiError instance with a retry hint', async () => {
    const core = new HandlerTestCore(
      new FakeAxBridgePort(undefined, new AxPermissionError('Accessibility permission not granted')),
    )

    try {
      await core.computerUse({ action: 'snapshot' })
      expect.unreachable('expected computerUse to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(DaemonApiError)
      const daemonError = error as DaemonApiError
      expect(daemonError.retryable).toBe(false)
      expect(daemonError.hint).toContain('Accessibility')
    }
  })
})
