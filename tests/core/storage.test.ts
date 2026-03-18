import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findProjectRoot, getStoragePath } from '../../src/core/storage.js'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

describe('findProjectRoot', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false)
  })

  it('returns directory containing .git', () => {
    vi.mocked(existsSync).mockImplementation((p: string) =>
      p === '/Users/dev/myproject/.git'
    )
    expect(findProjectRoot('/Users/dev/myproject/src/lib')).toBe('/Users/dev/myproject')
  })

  it('returns directory containing package.json', () => {
    vi.mocked(existsSync).mockImplementation((p: string) =>
      p === '/Users/dev/myproject/package.json'
    )
    expect(findProjectRoot('/Users/dev/myproject/src')).toBe('/Users/dev/myproject')
  })

  it('returns directory containing .spectra/', () => {
    vi.mocked(existsSync).mockImplementation((p: string) =>
      p === '/Users/dev/myproject/.spectra'
    )
    expect(findProjectRoot('/Users/dev/myproject/deep/nested')).toBe('/Users/dev/myproject')
  })

  it('returns null when no project root found', () => {
    expect(findProjectRoot('/Users/dev/random')).toBeNull()
  })
})

describe('getStoragePath', () => {
  it('returns project-local path when project root exists', () => {
    vi.mocked(existsSync).mockImplementation((p: string) =>
      p === '/Users/dev/myproject/.git'
    )
    const path = getStoragePath('/Users/dev/myproject/src')
    expect(path).toBe('/Users/dev/myproject/.spectra')
  })

  it('returns global path when no project root', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const path = getStoragePath('/tmp/random')
    expect(path).toBe(join(homedir(), '.spectra'))
  })
})
