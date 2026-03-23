import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionManager } from '../../src/core/session.js'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Snapshot, Action } from '../../src/core/types.js'

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
  readdir: vi.fn().mockResolvedValue([]),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}))

vi.mock('../../src/core/storage.js', () => ({
  getStoragePath: vi.fn().mockReturnValue('/tmp/test-spectra'),
}))

describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new SessionManager()
  })

  describe('create', () => {
    it('creates a session with generated ID and name', async () => {
      const session = await manager.create({
        name: 'login-test',
        platform: 'web',
        target: { url: 'http://localhost:3000' },
      })

      expect(session.id).toBeTruthy()
      expect(session.name).toBe('login-test')
      expect(session.platform).toBe('web')
      expect(session.steps).toEqual([])
      expect(mkdir).toHaveBeenCalled()
    })

    it('generates a name from URL when not provided', async () => {
      const session = await manager.create({
        platform: 'web',
        target: { url: 'http://localhost:3000/login' },
      })

      expect(session.name).toContain('localhost')
    })
  })

  describe('addStep', () => {
    it('records a step and persists snapshot + screenshot', async () => {
      const session = await manager.create({
        name: 'test',
        platform: 'web',
        target: { url: 'http://localhost:3000' },
      })

      const snapshot: Snapshot = {
        platform: 'web',
        elements: [],
        timestamp: Date.now(),
      }
      const action: Action = { type: 'click', elementId: 'e1' }
      const screenshot = Buffer.from('PNG')

      await manager.addStep(session.id, {
        action,
        snapshotBefore: snapshot,
        snapshotAfter: snapshot,
        screenshot,
        success: true,
        duration: 150,
      })

      const updated = manager.get(session.id)
      expect(updated!.steps).toHaveLength(1)
      expect(updated!.steps[0].index).toBe(0)
      expect(updated!.steps[0].success).toBe(true)

      // Verify files were written
      expect(writeFile).toHaveBeenCalledTimes(5) // 2 snapshots + 1 screenshot + 2 session.json (create + addStep)
    })
  })

  describe('get', () => {
    it('returns null for unknown session', () => {
      expect(manager.get('nonexistent')).toBeNull()
    })
  })

  describe('list', () => {
    it('returns all active sessions', async () => {
      await manager.create({ name: 'a', platform: 'web', target: { url: 'http://a.com' } })
      await manager.create({ name: 'b', platform: 'web', target: { url: 'http://b.com' } })

      const sessions = manager.list()
      expect(sessions).toHaveLength(2)
    })
  })

  describe('close', () => {
    it('persists final session.json and removes from active', async () => {
      const session = await manager.create({
        name: 'test',
        platform: 'web',
        target: { url: 'http://localhost:3000' },
      })

      await manager.close(session.id)

      expect(manager.get(session.id)).toBeNull()
      expect(writeFile).toHaveBeenCalled() // final session.json save
    })

    it('sets closedAt on the session before persisting', async () => {
      const before = Date.now()
      const session = await manager.create({
        name: 'test',
        platform: 'web',
        target: { url: 'http://localhost:3000' },
      })

      // Capture the session object reference before close removes it
      const sessionRef = manager.get(session.id)!
      await manager.close(session.id)

      expect(sessionRef.closedAt).toBeGreaterThanOrEqual(before)
      expect(sessionRef.closedAt).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('addStep with intent', () => {
    it('persists intent in the step', async () => {
      const session = await manager.create({
        name: 'test',
        platform: 'web',
        target: { url: 'http://localhost:3000' },
      })

      const snapshot: Snapshot = {
        platform: 'web',
        elements: [],
        timestamp: Date.now(),
      }
      const action: Action = { type: 'click', elementId: 'e1' }

      await manager.addStep(session.id, {
        action,
        snapshotBefore: snapshot,
        snapshotAfter: snapshot,
        screenshot: Buffer.from('PNG'),
        success: true,
        duration: 100,
        intent: 'click the login button',
      })

      const updated = manager.get(session.id)!
      expect(updated.steps[0].intent).toBe('click the login button')
    })
  })
})
