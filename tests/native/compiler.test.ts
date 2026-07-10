// tests/native/compiler.test.ts
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BINARY_PATH,
  BUNDLE_HELPERS_DIR_ENV,
  BUNDLE_PATH_ENV,
  CURSOR_SAMPLER_PATH_ENV,
  HELPER_MODE_ENV,
  NATIVE_HELPER_PATH_ENV,
  WINDOW_BOUNDS_PATH_ENV,
  compile,
  ensureBinary,
  ensureCompositeBinary,
  ensureCursorSamplerBinary,
  ensureScreenRecordingPreflightBinary,
  ensureTextRenderBinary,
  isStale,
} from '../../src/native/compiler.js'

const HELPER_ENV_KEYS = [
  HELPER_MODE_ENV,
  BUNDLE_HELPERS_DIR_ENV,
  BUNDLE_PATH_ENV,
  NATIVE_HELPER_PATH_ENV,
  CURSOR_SAMPLER_PATH_ENV,
  WINDOW_BOUNDS_PATH_ENV,
] as const

const ensureCases = [
  ['spectra-native', ensureBinary],
  ['spectra-composite-capture', ensureCompositeBinary],
  ['spectra-screen-recording-preflight', ensureScreenRecordingPreflightBinary],
  ['spectra-cursor-sampler', ensureCursorSamplerBinary],
  ['spectra-text-render', ensureTextRenderBinary],
] as const

let priorEnv: Partial<Record<(typeof HELPER_ENV_KEYS)[number], string>>
let tempDirs: string[]

function tempHelpersDir(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'spectra-ts-helpers-')))
  tempDirs.push(path)
  return path
}

function writeExecutable(path: string): void {
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
}

beforeEach(() => {
  priorEnv = {}
  tempDirs = []
  for (const key of HELPER_ENV_KEYS) {
    if (process.env[key] !== undefined) priorEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of HELPER_ENV_KEYS) {
    const prior = priorEnv[key]
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
  }
  for (const path of tempDirs) rmSync(path, { recursive: true, force: true })
})

describe('compiler', () => {
  it('compiles the Swift binary', () => {
    compile()
    expect(existsSync(BINARY_PATH)).toBe(true)
  }, 20_000)

  it('reports not stale after fresh compile', () => {
    expect(isStale()).toBe(false)
  })

  it('development mode uses the home binary even when a configured bundle helper exists', () => {
    const helpersDir = tempHelpersDir()
    writeExecutable(join(helpersDir, 'spectra-native'))
    process.env[HELPER_MODE_ENV] = 'development'
    process.env[BUNDLE_HELPERS_DIR_ENV] = helpersDir

    const path = ensureBinary()
    expect(path).toBe(BINARY_PATH)
    expect(existsSync(path)).toBe(true)
  }, 20_000)

  it.each(ensureCases)(
    'fails closed for a partial bundle missing %s',
    (missingHelper, ensureHelper) => {
      const helpersDir = tempHelpersDir()
      for (const [helperName] of ensureCases) {
        if (helperName !== missingHelper) writeExecutable(join(helpersDir, helperName))
      }
      process.env[HELPER_MODE_ENV] = 'bundle'
      process.env[BUNDLE_HELPERS_DIR_ENV] = helpersDir

      expect(() => ensureHelper()).toThrow(missingHelper)
    },
  )

  it('resolves all five ensure functions from a complete authoritative bundle', () => {
    const helpersDir = tempHelpersDir()
    for (const [helperName] of ensureCases) writeExecutable(join(helpersDir, helperName))
    process.env[HELPER_MODE_ENV] = 'bundle'
    process.env[BUNDLE_HELPERS_DIR_ENV] = helpersDir

    for (const [helperName, ensureHelper] of ensureCases) {
      expect(ensureHelper()).toBe(join(helpersDir, helperName))
    }
  })

  it('rejects a bundled helper symlink that resolves outside Contents/Helpers', () => {
    const helpersDir = tempHelpersDir()
    const outsideDir = tempHelpersDir()
    const outsideHelper = join(outsideDir, 'spectra-native')
    writeExecutable(outsideHelper)
    symlinkSync(outsideHelper, join(helpersDir, 'spectra-native'))
    process.env[HELPER_MODE_ENV] = 'bundle'
    process.env[BUNDLE_HELPERS_DIR_ENV] = helpersDir

    expect(() => ensureBinary()).toThrow(/physical file inside Contents\/Helpers/)
  })

  it('rejects a bundle path whose parent component is a symlink', () => {
    const fixtureDir = tempHelpersDir()
    const realBundle = join(fixtureDir, 'real', 'Spectra.app')
    const helpersDir = join(realBundle, 'Contents', 'Helpers')
    mkdirSync(helpersDir, { recursive: true })
    writeExecutable(join(helpersDir, 'spectra-native'))
    const aliasBundle = join(fixtureDir, 'Spectra.app')
    symlinkSync(realBundle, aliasBundle, 'dir')
    process.env[HELPER_MODE_ENV] = 'bundle'
    process.env[BUNDLE_PATH_ENV] = aliasBundle

    expect(() => ensureBinary()).toThrow(/physical, non-symlink directory/)
  })

  it.each([
    ['native', NATIVE_HELPER_PATH_ENV, ensureBinary],
    ['cursor', CURSOR_SAMPLER_PATH_ENV, ensureCursorSamplerBinary],
  ] as const)('keeps the %s-specific override authoritative', (_label, overrideEnv, ensureHelper) => {
    const helpersDir = tempHelpersDir()
    const override = join(helpersDir, 'specific-helper')
    writeExecutable(override)
    process.env[HELPER_MODE_ENV] = 'development'
    process.env[BUNDLE_HELPERS_DIR_ENV] = join(helpersDir, 'missing-bundle')
    process.env[overrideEnv] = override

    expect(ensureHelper()).toBe(override)
  })

  it('requires a bundle-mode specific override to remain at the configured helper path', () => {
    const helpersDir = tempHelpersDir()
    const expected = join(helpersDir, 'spectra-native')
    const outside = join(tempHelpersDir(), 'spectra-native')
    writeExecutable(expected)
    writeExecutable(outside)
    process.env[HELPER_MODE_ENV] = 'bundle'
    process.env[BUNDLE_HELPERS_DIR_ENV] = helpersDir
    process.env[NATIVE_HELPER_PATH_ENV] = outside

    expect(() => ensureBinary()).toThrow(/must resolve to/)
  })

  it('rejects a non-executable specific override without falling back', () => {
    const helpersDir = tempHelpersDir()
    const override = join(helpersDir, 'spectra-native')
    writeFileSync(override, 'not executable')
    process.env[HELPER_MODE_ENV] = 'development'
    process.env[NATIVE_HELPER_PATH_ENV] = override

    expect(() => ensureBinary()).toThrow(NATIVE_HELPER_PATH_ENV)
  })

  it('rejects an executable symlink used as a specific override', () => {
    const helpersDir = tempHelpersDir()
    const target = join(helpersDir, 'real-native')
    const override = join(helpersDir, 'spectra-native')
    writeExecutable(target)
    symlinkSync(target, override)
    process.env[HELPER_MODE_ENV] = 'development'
    process.env[NATIVE_HELPER_PATH_ENV] = override

    expect(() => ensureBinary()).toThrow(/regular, non-symlink executable/)
  })
})
