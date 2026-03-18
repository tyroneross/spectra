// tests/native/compiler.test.ts
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { isStale, compile, ensureBinary, BINARY_PATH } from '../../src/native/compiler.js'

describe('compiler', () => {
  it('compiles the Swift binary', () => {
    compile()
    expect(existsSync(BINARY_PATH)).toBe(true)
  })

  it('reports not stale after fresh compile', () => {
    expect(isStale()).toBe(false)
  })

  it('ensureBinary returns path to binary', () => {
    const path = ensureBinary()
    expect(path).toBe(BINARY_PATH)
    expect(existsSync(path)).toBe(true)
  })
})
