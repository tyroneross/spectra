import { describe, it, expect } from 'vitest'
import type {
  Element, Snapshot, SnapshotMetadata, Action, ActionType, ActResult,
  Driver, DriverTarget, Session, Step, Platform,
  ResolveOptions, ResolveResult,
} from '../../src/core/types.js'

describe('Core Types', () => {
  it('creates a valid Element with all fields', () => {
    const el: Element = {
      id: 'e1', role: 'button', label: 'Log In', value: null,
      enabled: true, focused: false, actions: ['press'],
      bounds: [100, 200, 80, 32], parent: null,
    }
    expect(el.id).toBe('e1')
    expect(el.bounds).toHaveLength(4)
  })

  it('creates a Snapshot with metadata', () => {
    const snapshot: Snapshot = {
      url: 'http://localhost:3000', platform: 'web', elements: [],
      timestamp: Date.now(),
      metadata: { elementCount: 0, stableAt: Date.now(), timedOut: false },
    }
    expect(snapshot.platform).toBe('web')
    expect(snapshot.metadata?.timedOut).toBe(false)
  })

  it('creates an Action and ActResult', () => {
    const action: Action = { type: 'click', elementId: 'e1' }
    const result: ActResult = {
      success: true,
      snapshot: { platform: 'web', elements: [], timestamp: Date.now() },
    }
    expect(action.type).toBe('click')
    expect(result.success).toBe(true)
  })

  it('creates a Session with Steps', () => {
    const step: Step = {
      index: 0, action: { type: 'click', elementId: 'e1' },
      snapshotBefore: 'snapshots/step-000-before.json',
      snapshotAfter: 'snapshots/step-000-after.json',
      screenshotPath: 'step-000.png', success: true,
      timestamp: Date.now(), duration: 150,
    }
    const session: Session = {
      id: 'abc123', name: 'login-test', platform: 'web',
      target: { url: 'http://localhost:3000' },
      steps: [step], createdAt: Date.now(), updatedAt: Date.now(),
    }
    expect(session.steps).toHaveLength(1)
    expect(session.steps[0].success).toBe(true)
  })

  it('creates ResolveOptions and ResolveResult', () => {
    const el: Element = {
      id: 'e4', role: 'button', label: 'Submit', value: null,
      enabled: true, focused: false, actions: ['press'],
      bounds: [0, 0, 80, 32], parent: null,
    }
    const opts: ResolveOptions = { intent: 'click Submit', elements: [el], mode: 'claude' }
    const result: ResolveResult = { element: el, confidence: 1.0 }
    expect(opts.mode).toBe('claude')
    expect(result.confidence).toBe(1.0)
  })
})
