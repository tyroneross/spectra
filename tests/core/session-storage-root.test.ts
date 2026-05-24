// tests/core/session-storage-root.test.ts
//
// C2.6 — Verify SessionManager.create(repoPath) anchors session storage under
// the supplied repo regardless of process.cwd(). This is the launchd-spawned
// daemon path: CWD=$HOME, repoPath=<user repo>, artifacts must land in
// <repo>/.spectra/sessions/<id>, NOT ~/.spectra/sessions/<id>.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SessionManager } from '../../src/core/session.js'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('SessionManager — C2.6 repoPath anchoring', () => {
  let repoRoot: string
  let bogusCwdRoot: string
  const originalCwd = process.cwd()

  beforeEach(async () => {
    // Two distinct temp dirs: one is the "repo" we anchor under; the other
    // mimics the daemon's launchd CWD (~$HOME — somewhere we DO NOT want
    // session artifacts to land).
    repoRoot = await mkdtemp(join(tmpdir(), 'spectra-c26-repo-'))
    bogusCwdRoot = await mkdtemp(join(tmpdir(), 'spectra-c26-bogus-cwd-'))
    // Mark repoRoot as a project (so findProjectRoot stops there).
    await writeFile(join(repoRoot, 'package.json'), '{}')
    process.chdir(bogusCwdRoot)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(repoRoot, { recursive: true, force: true })
    await rm(bogusCwdRoot, { recursive: true, force: true })
  })

  it('anchors session.storageRoot under repoPath when supplied', async () => {
    const manager = new SessionManager()
    const session = await manager.create({
      platform: 'web',
      target: { url: 'http://localhost:3000' },
      repoPath: repoRoot,
    })

    expect(session.storageRoot).toBeDefined()
    expect(session.storageRoot!.startsWith(repoRoot)).toBe(true)
    expect(session.storageRoot).toContain('.spectra/sessions/')

    // Directory actually exists on disk under the repo.
    const stats = await stat(join(session.storageRoot!, 'snapshots'))
    expect(stats.isDirectory()).toBe(true)
  })

  it('sessionDir() returns the per-session storageRoot for repo-anchored sessions', async () => {
    const manager = new SessionManager()
    const session = await manager.create({
      platform: 'web',
      target: { url: 'http://localhost:3000' },
      repoPath: repoRoot,
    })

    expect(manager.sessionDir(session.id)).toBe(session.storageRoot!)
    expect(manager.sessionDir(session.id).startsWith(repoRoot)).toBe(true)
  })

  it('falls back to CWD-derived path when no repoPath is supplied', async () => {
    const manager = new SessionManager()
    const session = await manager.create({
      platform: 'web',
      target: { url: 'http://localhost:3000' },
    })

    // Should NOT be under repoRoot because we didn't pass it.
    expect(session.storageRoot!.startsWith(repoRoot)).toBe(false)
  })
})
