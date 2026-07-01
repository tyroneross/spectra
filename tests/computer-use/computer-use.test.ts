// tests/computer-use/computer-use.test.ts
//
// Unit-tests the AX-first computer-use orchestration by MOCKING the native AX
// bridge (injecting a fake AX snapshot — no GUI session needed). Covers:
//   • form-fill resolves labels → editable nodes, sets, and verifies each
//   • act routes click / set-value / key correctly
//   • the vision-fallback gate fires when the AX tree is empty / below threshold
//   • a wired, available VisionFallback grounds an empty tree
//   • permission errors surface as AxPermissionError (not a crash)
//   • snapshot caching + invalidation-on-action

import { describe, it, expect } from 'vitest'
import { ComputerUse } from '../../src/computer-use/computer-use.js'
import { AxPermissionError, type AxBridgePort, type RawActRequest, type RawActResult, type RawAxSnapshot, type RawClickAtRequest, type RawKeyRequest, type RawTypeTextRequest, type RawVisionAvailability, type RawVisionGrounding } from '../../src/computer-use/port.js'
import { NativeVisionFallback, type VisionFallback } from '../../src/computer-use/vision-fallback.js'
import type { AxNode, AxTarget } from '../../src/computer-use/types.js'

function node(partial: Partial<AxNode> & { role: string; label: string; path: number[] }): AxNode {
  return {
    source: 'ax',
    value: null,
    enabled: true,
    focused: false,
    actions: [],
    bounds: [0, 0, 10, 10],
    ...partial,
  }
}

/** Fake AX bridge: holds a canned snapshot, records acts, and echoes set-values
 * back (simulating kAXValue read-back) so verification can be exercised. */
class FakeAxBridgePort implements AxBridgePort {
  acts: RawActRequest[] = []
  keys: RawKeyRequest[] = []
  clicks: RawClickAtRequest[] = []
  typed: RawTypeTextRequest[] = []
  visionGroundCalls = 0
  permission: 'granted' | 'denied' = 'granted'
  visionAvailability: RawVisionAvailability = { available: false }
  visionGroundings: RawVisionGrounding[] = []
  /** Override to simulate a field that rejects/mangles the set (verify failure). */
  echo: (req: RawActRequest) => string | null = (req) => req.value ?? null

  constructor(private snapshot: RawAxSnapshot) {}

  async snapshotFocused(_target?: AxTarget): Promise<RawAxSnapshot> {
    if (this.permission === 'denied') {
      throw new AxPermissionError('Accessibility permission not granted.')
    }
    return this.snapshot
  }

  async act(req: RawActRequest): Promise<RawActResult> {
    this.acts.push(req)
    if (req.action === 'setValue') return { success: true, value: this.echo(req) }
    return { success: true }
  }

  async key(req: RawKeyRequest): Promise<{ success: boolean }> {
    this.keys.push(req)
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
    this.visionGroundCalls++
    return this.visionGroundings
  }

  async preflight(): Promise<{ trusted: boolean }> {
    return { trusted: this.permission === 'granted' }
  }
}

function loginFormSnapshot(): RawAxSnapshot {
  return {
    window: { title: 'Login', bounds: [0, 0, 400, 300] },
    focusedWindowTitle: 'Login',
    axStatus: 'ok',
    nodeCount: 3,
    elements: [
      node({ role: 'AXTextField', label: 'Email', actions: ['setValue'], path: [0, 1] }),
      node({ role: 'AXSecureTextField', label: 'Password', actions: ['setValue'], path: [0, 2] }),
      node({ role: 'AXButton', label: 'Sign In', actions: ['press'], path: [0, 3] }),
    ],
  }
}

describe('ComputerUse.fillForm — first-class form-filling', () => {
  it('resolves labels → editable AX nodes, sets, and verifies each field', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    const cu = new ComputerUse(port, { target: { app: 'Demo' } })

    const result = await cu.fillForm({ Email: 'a@b.com', Password: 'secret' })

    expect(result.allVerified).toBe(true)
    expect(result.needsVisionFallback).toBe(false)
    expect(result.fields).toHaveLength(2)
    expect(result.fields.every((f) => f.matched && f.set && f.verified)).toBe(true)
    // set via AX setValue on the resolved editable nodes (paths relative to the window)
    expect(port.acts.map((a) => a.action)).toEqual(['setValue', 'setValue'])
    expect(port.acts[0]?.elementPath).toEqual([0, 1])
    expect(port.acts[0]?.value).toBe('a@b.com')
    expect(result.fields[0]?.actual).toBe('a@b.com')
  })

  it('marks a field unverified when read-back does not match (verify by read-back, not by set-success)', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    port.echo = () => 'WRONG' // field mangles the value
    const cu = new ComputerUse(port)

    const result = await cu.fillForm({ Email: 'a@b.com' })
    expect(result.fields[0]?.set).toBe(true)
    expect(result.fields[0]?.verified).toBe(false)
    expect(result.allVerified).toBe(false)
  })

  it('reports an unmatched label without crashing', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    const cu = new ComputerUse(port)
    const result = await cu.fillForm({ 'Nonexistent Field': 'x' })
    expect(result.fields[0]?.matched).toBe(false)
    expect(result.allVerified).toBe(false)
  })
})

describe('ComputerUse.act — lazy self-snapshot (dead-act-path regression)', () => {
  // Deliberately do NOT call cu.snapshotFocusedWindow() first in these tests —
  // that prior call is exactly the gap that hid the bug: a standalone act on
  // a fresh instance (this.cache === null) must ground itself, mirroring
  // fillForm's self-snapshot at computer-use.ts ~line 153. Pre-fix, click()/
  // setValue() resolved against `this.cache?.nodes ?? []` directly, so a
  // fresh instance always saw an empty node list and reported matched:false.

  it('click with a null cache self-snapshots then resolves the node', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    const cu = new ComputerUse(port)

    const outcome = await cu.act({ kind: 'click', label: 'Sign In' })

    expect(outcome.matched).toBe(true)
    expect(outcome.success).toBe(true)
    expect(port.acts).toHaveLength(1)
    expect(port.acts[0]?.action).toBe('press')
    expect(port.acts[0]?.elementPath).toEqual([0, 3])
  })

  it('set-value with a null cache self-snapshots then resolves and verifies', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    const cu = new ComputerUse(port)

    const outcome = await cu.act({ kind: 'set-value', label: 'Email', value: 'a@b.com' })

    expect(outcome.matched).toBe(true)
    expect(outcome.verified).toBe(true)
    expect(outcome.actualValue).toBe('a@b.com')
    expect(port.acts[0]?.action).toBe('setValue')
  })

  it('a null-cache click only self-snapshots once even across repeated calls (cache reused, not re-walked)', async () => {
    let snapshotCalls = 0
    const base = loginFormSnapshot()
    const port: AxBridgePort = {
      async snapshotFocused() { snapshotCalls++; return base },
      async act() { return { success: true } },
      async key() { return { success: true } },
      async clickAt() { return { success: true } },
      async typeText() { return { success: true } },
      async visionAvailable() { return { available: false } },
      async visionGround() { return [] },
      async preflight() { return { trusted: true } },
    }
    const cu = new ComputerUse(port)

    await cu.act({ kind: 'click', label: 'Sign In' })
    expect(snapshotCalls).toBe(1)
  })
})

describe('ComputerUse.act — routing', () => {
  it('routes click-by-role-label to a press on the resolved node', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    const cu = new ComputerUse(port)
    await cu.snapshotFocusedWindow()

    const outcome = await cu.act({ kind: 'click', role: 'AXButton', label: 'Sign In' })
    expect(outcome.matched).toBe(true)
    expect(outcome.success).toBe(true)
    expect(port.acts).toHaveLength(1)
    expect(port.acts[0]?.action).toBe('press')
    expect(port.acts[0]?.elementPath).toEqual([0, 3])
  })

  it('routes set-value to a verified setValue', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    const cu = new ComputerUse(port)
    await cu.snapshotFocusedWindow()

    const outcome = await cu.act({ kind: 'set-value', label: 'Email', value: 'x@y.z' })
    expect(outcome.matched).toBe(true)
    expect(outcome.verified).toBe(true)
    expect(outcome.actualValue).toBe('x@y.z')
    expect(port.acts[0]?.action).toBe('setValue')
  })

  it('routes key to the native key primitive', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    const cu = new ComputerUse(port)
    const outcome = await cu.act({ kind: 'key', key: 'return' })
    expect(outcome.success).toBe(true)
    expect(port.keys).toEqual([{ target: undefined, key: 'return' }])
  })

  it('an unresolved click returns matched:false, not a throw', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    const cu = new ComputerUse(port)
    await cu.snapshotFocusedWindow()
    const outcome = await cu.act({ kind: 'click', label: 'Ghost Button' })
    expect(outcome.matched).toBe(false)
    expect(outcome.success).toBe(false)
  })
})

describe('ComputerUse — vision-fallback gate (AX-node-count)', () => {
  const emptySnapshot: RawAxSnapshot = {
    window: { title: 'Canvas', bounds: [0, 0, 800, 600] },
    focusedWindowTitle: 'Canvas',
    axStatus: 'empty',
    nodeCount: 0,
    elements: [],
  }

  it('signals needsVisionFallback when the AX tree is empty (no crash)', async () => {
    const port = new FakeAxBridgePort(emptySnapshot)
    const cu = new ComputerUse(port)
    const snap = await cu.snapshotFocusedWindow()
    expect(snap.needsVisionFallback).toBe(true)
    expect(snap.fallbackReason).toBe('empty')
    expect(snap.nodes).toHaveLength(0)
  })

  it('fires the gate below a custom threshold even when axStatus is ok', async () => {
    const thin: RawAxSnapshot = { ...loginFormSnapshot(), axStatus: 'ok', nodeCount: 3 }
    const port = new FakeAxBridgePort(thin)
    const cu = new ComputerUse(port, { visionFallbackThreshold: 5 })
    const snap = await cu.snapshotFocusedWindow()
    expect(snap.needsVisionFallback).toBe(true)
    expect(snap.fallbackReason).toBe('below-threshold')
  })

  it('does NOT fire the gate for a healthy AX tree', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    const cu = new ComputerUse(port)
    const snap = await cu.snapshotFocusedWindow()
    expect(snap.needsVisionFallback).toBe(false)
  })

  it('grounds via a wired, available VisionFallback and clears the signal', async () => {
    const port = new FakeAxBridgePort(emptySnapshot)
    const grounded: AxNode[] = [
      node({ source: 'vision', role: 'AXButton', label: 'Play', actions: ['press'], bounds: [10, 20, 40, 20], path: [] }),
      node({ source: 'vision', role: 'AXButton', label: 'Stop', actions: ['press'], bounds: [60, 20, 40, 20], path: [] }),
    ]
    let called = false
    const vf: VisionFallback = {
      name: 'test-vision',
      available: () => true,
      async ground() { called = true; return grounded },
    }
    const cu = new ComputerUse(port, { visionFallback: vf })
    const snap = await cu.snapshotFocusedWindow()
    expect(called).toBe(true)
    expect(snap.needsVisionFallback).toBe(false)
    expect(snap.fallbackReason).toBe('vision-fallback-applied')
    expect(snap.nodes).toHaveLength(2)
    expect(snap.axStatus).toBe('ok')
    expect(snap.nodes.every((n) => n.source === 'vision')).toBe(true)
  })

  it('NativeVisionFallback maps native OCR groundings to vision nodes and gates availability', async () => {
    const port = new FakeAxBridgePort(emptySnapshot)
    port.visionAvailability = { available: true }
    port.visionGroundings = [{ label: 'Email', bounds: [20, 40, 120, 22], confidence: 0.91 }]

    const vf = new NativeVisionFallback(port, { available: true })
    expect(vf.available()).toBe(true)
    const nodes = await vf.ground(undefined, { reason: 'empty', nodeCount: 0 })

    expect(port.visionGroundCalls).toBe(1)
    expect(nodes).toMatchObject([
      { source: 'vision', role: 'AXTextField', label: 'Email', bounds: [20, 40, 120, 22], confidence: 0.91, path: [] },
    ])

    const unavailable = new NativeVisionFallback(port, { available: false, unavailableReason: 'Screen Recording permission not granted' })
    expect(unavailable.available()).toBe(false)
    await expect(unavailable.ground(undefined, { reason: 'empty', nodeCount: 0 })).rejects.toMatchObject({
      name: 'VisionFallbackUnavailableError',
    })
  })

  it('resolves a vision click through clickAt, never AXPress', async () => {
    const port = new FakeAxBridgePort(emptySnapshot)
    const vf: VisionFallback = {
      name: 'test-vision',
      available: () => true,
      async ground() {
        return [node({ source: 'vision', role: 'AXButton', label: 'Play', actions: ['press'], bounds: [10, 20, 40, 20], path: [] })]
      },
    }
    const cu = new ComputerUse(port, { visionFallback: vf })

    const outcome = await cu.act({ kind: 'click', label: 'Play' })

    expect(outcome.matched).toBe(true)
    expect(outcome.success).toBe(true)
    expect(port.clicks).toEqual([{ target: undefined, x: 30, y: 30 }])
    expect(port.acts).toHaveLength(0)
  })

  it('sets a vision field by click-to-focus then typeText and leaves verification false', async () => {
    const port = new FakeAxBridgePort(emptySnapshot)
    const vf: VisionFallback = {
      name: 'test-vision',
      available: () => true,
      async ground() {
        return [node({ source: 'vision', role: 'AXTextField', label: 'Email', actions: ['press', 'setValue'], bounds: [20, 40, 120, 20], path: [] })]
      },
    }
    const cu = new ComputerUse(port, { visionFallback: vf, target: { app: 'CanvasApp' } })

    const outcome = await cu.act({ kind: 'set-value', label: 'Email', value: 'a@b.com' })

    expect(outcome.matched).toBe(true)
    expect(outcome.success).toBe(true)
    expect(outcome.verified).toBe(false)
    expect(outcome.actualValue).toBeNull()
    expect(port.clicks).toEqual([{ target: { app: 'CanvasApp' }, x: 80, y: 50 }])
    expect(port.typed).toEqual([{ target: { app: 'CanvasApp' }, text: 'a@b.com' }])
    expect(port.acts).toHaveLength(0)
  })

  it('fill-form on an empty tree returns the fallback signal, not a crash', async () => {
    const port = new FakeAxBridgePort(emptySnapshot)
    const cu = new ComputerUse(port)
    const result = await cu.fillForm({ Email: 'a@b.com' })
    expect(result.needsVisionFallback).toBe(true)
    expect(result.fields[0]?.matched).toBe(false)
  })
})

describe('ComputerUse — failure modes + efficiency', () => {
  it('surfaces a permission denial as AxPermissionError', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    port.permission = 'denied'
    const cu = new ComputerUse(port)
    await expect(cu.snapshotFocusedWindow()).rejects.toBeInstanceOf(AxPermissionError)
  })

  it('caches the snapshot and re-reads only on change', async () => {
    let snapshotCalls = 0
    const base = loginFormSnapshot()
    const port: AxBridgePort = {
      async snapshotFocused() { snapshotCalls++; return base },
      async act() { return { success: true, value: 'v' } },
      async key() { return { success: true } },
      async clickAt() { return { success: true } },
      async typeText() { return { success: true } },
      async visionAvailable() { return { available: false } },
      async visionGround() { return [] },
      async preflight() { return { trusted: true } },
    }
    const cu = new ComputerUse(port)
    await cu.snapshotFocusedWindow()
    await cu.snapshotFocusedWindow() // cache hit — no new native read
    expect(snapshotCalls).toBe(1)

    await cu.act({ kind: 'key', key: 'tab' }) // invalidates cache
    await cu.snapshotFocusedWindow()
    expect(snapshotCalls).toBe(2)
  })

  it('preflight delegates to the bridge', async () => {
    const port = new FakeAxBridgePort(loginFormSnapshot())
    port.permission = 'denied'
    const cu = new ComputerUse(port)
    expect(await cu.preflight()).toEqual({ trusted: false })
  })
})
