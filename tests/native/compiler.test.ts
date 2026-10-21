// tests/native/compiler.test.ts
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { isStale, compile, ensureBinary, BINARY_PATH, resolveBundleHelpersDir } from '../../src/native/compiler.js'

describe('compiler', () => {
  it('compiles the Swift binary', () => {
    compile()
    expect(existsSync(BINARY_PATH)).toBe(true)
  }, 60_000)

  it('reports not stale after fresh compile', () => {
    expect(isStale()).toBe(false)
  })

  it('ensureBinary returns path to binary', () => {
    const path = ensureBinary()
    const bundle = resolveBundleHelpersDir()
    expect(path).toBe(bundle ? join(bundle, 'spectra-native') : BINARY_PATH)
    expect(existsSync(path)).toBe(true)
  }, 60_000)
})
