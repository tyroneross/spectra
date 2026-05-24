// tests/cli/token.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOrCreateDaemonToken, tokenMatches, tokenFileMode } from '../../src/cli/token.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'spectra-token-test-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('getOrCreateDaemonToken', () => {
  it('mints a new token on first call', () => {
    const r = getOrCreateDaemonToken(tmp)
    expect(r.created).toBe(true)
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(statSync(r.path).isFile()).toBe(true)
  })

  it('reuses the existing token on second call', () => {
    const first = getOrCreateDaemonToken(tmp)
    const second = getOrCreateDaemonToken(tmp)
    expect(second.created).toBe(false)
    expect(second.token).toBe(first.token)
  })

  it('writes the token file as mode 0600', () => {
    const r = getOrCreateDaemonToken(tmp)
    expect(tokenFileMode(r.path)).toBe(0o600)
  })

  it('overwrites a malformed token file', () => {
    const path = join(tmp, 'daemon.token')
    writeFileSync(path, 'not a valid token format!@#\n', { mode: 0o600 })
    const r = getOrCreateDaemonToken(tmp)
    expect(r.created).toBe(true)
    expect(r.token).not.toBe('not a valid token format!@#')
  })
})

describe('tokenMatches', () => {
  const token = 'a'.repeat(32)

  it('returns false for missing header', () => {
    expect(tokenMatches(undefined, token)).toBe(false)
  })

  it('returns false for wrong scheme', () => {
    expect(tokenMatches(`Basic ${token}`, token)).toBe(false)
  })

  it('returns false for wrong token of same length', () => {
    expect(tokenMatches(`Bearer ${'b'.repeat(32)}`, token)).toBe(false)
  })

  it('returns false for wrong-length token (avoids timingSafeEqual throw)', () => {
    expect(tokenMatches(`Bearer ${'a'.repeat(31)}`, token)).toBe(false)
    expect(tokenMatches(`Bearer ${'a'.repeat(33)}`, token)).toBe(false)
  })

  it('returns true for exact match', () => {
    expect(tokenMatches(`Bearer ${token}`, token)).toBe(true)
  })

  it('case-insensitive scheme name', () => {
    expect(tokenMatches(`bearer ${token}`, token)).toBe(true)
    expect(tokenMatches(`BEARER ${token}`, token)).toBe(true)
  })
})
