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
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { CoreApiImplementation } from '../../src/daemon/core-impl.js'
import { DaemonApiError } from '../../src/daemon/errors.js'
import { AxPermissionError, type AxBridgePort, type RawActResult, type RawAxSnapshot } from '../../src/computer-use/port.js'
import type { AxNode } from '../../src/computer-use/types.js'
import type { ComputerUseSnapshotResult } from '../../src/contract/core-api.js'

function mkNode(label: string): AxNode {
  return {
    role: 'AXButton',
    label,
    value: null,
    enabled: true,
    focused: false,
    actions: ['press'],
    bounds: [0, 0, 10, 10],
    path: [0],
  }
}

/** Fake AX bridge: returns a fixed snapshot (2 nodes, axStatus 'ok') or throws. */
class FakeAxBridgePort implements AxBridgePort {
  constructor(
    private readonly snapshot?: RawAxSnapshot,
    private readonly failWith?: Error,
  ) {}

  async snapshotFocused(): Promise<RawAxSnapshot> {
    if (this.failWith) throw this.failWith
    return this.snapshot!
  }

  async act(): Promise<RawActResult> {
    return { success: true }
  }

  async key(): Promise<{ success: boolean }> {
    return { success: true }
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
}

describe('CoreApiImplementation#computerUse (daemon handler)', () => {
  const twoNodeSnapshot: RawAxSnapshot = {
    window: { title: 'Test Window', bounds: [0, 0, 800, 600] },
    elements: [mkNode('Save'), mkNode('Cancel')],
    nodeCount: 2,
    axStatus: 'ok',
    focusedWindowTitle: 'Test Window',
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
