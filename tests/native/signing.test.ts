// tests/native/signing.test.ts
//
// Unit + macOS-integration coverage for the grant-durable signing layer
// (src/native/signing.ts): stable identifier mapping, identity resolution
// precedence, and the cdhash-based staleness detector that powers
// getPermissions' `grant_stale_rebuild` diagnosis.
//
// The staleness integration test compiles + re-signs a throwaway binary in a
// TEMP HOME — it never touches the real ~/.spectra/bin, so it is safe to run
// while a live TCC grant flow is in progress.
//
// SPDX-License-Identifier: Apache-2.0
// (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  slugFor,
  identifierFor,
  resolveSigningIdentity,
} from '../../src/native/signing.js'

const ALL_HELPERS = [
  ['spectra-daemon-launcher', 'dev.spectra.daemon-launcher'],
  ['spectra-daemon-core', 'dev.spectra.daemon-core'],
  ['spectra-native', 'dev.spectra.native'],
  ['spectra-screen-recording-preflight', 'dev.spectra.screen-recording-preflight'],
  ['spectra-composite-capture', 'dev.spectra.composite-capture'],
  ['spectra-cursor-sampler', 'dev.spectra.cursor-sampler'],
  ['spectra-window-bounds', 'dev.spectra.window-bounds'],
  ['spectra-text-render', 'dev.spectra.text-render'],
] as const

describe('signing — stable identifier mapping', () => {
  it('maps every helper to dev.spectra.<slug> (leading spectra- stripped)', () => {
    for (const [name, expected] of ALL_HELPERS) {
      expect(identifierFor(name)).toBe(expected)
      // Works on a full path too.
      expect(identifierFor(`/Users/x/.spectra/bin/${name}`)).toBe(expected)
    }
  })

  it('slugFor strips only a leading spectra- prefix', () => {
    expect(slugFor('spectra-native')).toBe('native')
    expect(slugFor('daemon-core')).toBe('daemon-core') // no prefix → unchanged
  })
})

describe('signing — identity resolution precedence', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.SPECTRA_CODESIGN
    delete process.env.SPECTRA_CODESIGN_IDENTITY
    delete process.env.SPECTRA_STABLE_SIGNING
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('SPECTRA_CODESIGN=0 skips signing', () => {
    process.env.SPECTRA_CODESIGN = '0'
    expect(resolveSigningIdentity()).toEqual({ identity: null, mode: 'skip' })
  })

  it('explicit SPECTRA_CODESIGN_IDENTITY wins', () => {
    process.env.SPECTRA_CODESIGN_IDENTITY = 'Developer ID Application: Someone (TEAM123)'
    expect(resolveSigningIdentity()).toEqual({
      identity: 'Developer ID Application: Someone (TEAM123)',
      mode: 'explicit',
    })
  })

  it('explicit identity of "skip" skips', () => {
    process.env.SPECTRA_CODESIGN_IDENTITY = 'skip'
    expect(resolveSigningIdentity()).toEqual({ identity: null, mode: 'skip' })
  })

  it('SPECTRA_STABLE_SIGNING=0 forces ad-hoc (never consults the keychain)', () => {
    process.env.SPECTRA_STABLE_SIGNING = '0'
    expect(resolveSigningIdentity()).toEqual({ identity: '-', mode: 'adhoc' })
  })
})

// ─── macOS integration: cdhash staleness detector, in a temp HOME ────────────

const onMac = process.platform === 'darwin'
const macDescribe = onMac ? describe : describe.skip

macDescribe('signing — cdhash staleness detector (temp HOME, real codesign)', () => {
  let home: string
  let binPath: string
  let mod: typeof import('../../src/native/signing.js')

  function compileAndSign(marker: string): void {
    const src = join(home, `hello-${marker}.swift`)
    writeFileSync(src, `import Foundation\nprint("${marker}")\n`)
    execFileSync('swiftc', [src, '-o', binPath])
    execFileSync('codesign', [
      '--force', '--timestamp=none', '--options', 'runtime',
      '-i', 'dev.spectra.screen-recording-preflight', '--sign', '-', binPath,
    ])
  }

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'spectra-signing-'))
    mkdirSync(join(home, '.spectra', 'bin'), { recursive: true })
    binPath = join(home, '.spectra', 'bin', 'spectra-screen-recording-preflight')
    // SPECTRA_HOME is a reliable, module-load-time redirect (os.homedir() is not
    // dependably stubbable under vitest — an earlier version of this test leaked
    // writes into the real ~/.spectra).
    vi.stubEnv('SPECTRA_HOME', join(home, '.spectra'))
    vi.resetModules()
    mod = await import('../../src/native/signing.js')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
  })

  it('records the stable identifier + a cdhash into the signing manifest', () => {
    compileAndSign('v1')
    const entry = mod.recordSigningManifest(binPath)
    expect(entry.identifier).toBe('dev.spectra.screen-recording-preflight')
    expect(entry.cdhash).toMatch(/^[0-9a-f]{40}/)
    expect(existsSync(mod.SIGNING_MANIFEST_PATH)).toBe(true)
    const onDisk = JSON.parse(readFileSync(mod.SIGNING_MANIFEST_PATH, 'utf8'))
    expect(onDisk['spectra-screen-recording-preflight'].identifier)
      .toBe('dev.spectra.screen-recording-preflight')
  })

  it('a freshly-granted cdhash is NOT stale', () => {
    compileAndSign('v1')
    mod.recordGrant('screen-recording', binPath)
    expect(mod.assessGrantStaleness('screen-recording', binPath)).toEqual({ stale: false })
  })

  it('rebuilding the helper (new cdhash) makes the recorded grant stale', () => {
    compileAndSign('v1')
    mod.recordGrant('screen-recording', binPath)
    const before = mod.readCdhash(binPath)

    compileAndSign('v2-different-source') // same path, different bytes → new cdhash
    const after = mod.readCdhash(binPath)
    expect(after).not.toBe(before)

    const verdict = mod.assessGrantStaleness('screen-recording', binPath)
    expect(verdict.stale).toBe(true)
    if (verdict.stale) {
      expect(verdict.grantedCdhash).toBe(before)
      expect(verdict.currentCdhash).toBe(after)
    }
  })

  it('with no recorded grant, nothing is stale', () => {
    compileAndSign('v1')
    expect(mod.assessGrantStaleness('screen-recording', binPath)).toEqual({ stale: false })
  })
})
