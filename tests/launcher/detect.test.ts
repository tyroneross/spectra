// tests/launcher/detect.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectRepoKind } from '../../src/launcher/detect.js'
import { LauncherError } from '../../src/launcher/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'spectra-detect-test-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('detectRepoKind', () => {
  it('detects Next.js via package.json next dep', () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      dependencies: { next: '^16.0.0', react: '^19.0.0' },
      scripts: { dev: 'next dev' },
    }))
    const r = detectRepoKind(tmp)
    expect(r.kind).toBe('web-next')
    expect(r.startCommand).toEqual(['npm', 'run', 'dev'])
  })

  it('detects Vite via package.json vite dep', () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      devDependencies: { vite: '^5.0.0' },
      scripts: { dev: 'vite' },
    }))
    const r = detectRepoKind(tmp)
    expect(r.kind).toBe('web-vite')
    expect(r.startCommand).toEqual(['npm', 'run', 'dev'])
  })

  it('detects static HTML via index.html at root', () => {
    writeFileSync(join(tmp, 'index.html'), '<!doctype html><html></html>')
    const r = detectRepoKind(tmp)
    expect(r.kind).toBe('web-static')
    expect(r.staticEntry).toBe(join(tmp, 'index.html'))
  })

  it('detects macOS via .xcodeproj', () => {
    mkdirSync(join(tmp, 'MyApp.xcodeproj'))
    const r = detectRepoKind(tmp)
    expect(r.kind).toBe('macos')
    expect(r.xcodeTarget).toBe(join(tmp, 'MyApp.xcodeproj'))
  })

  it('prefers .xcworkspace over .xcodeproj when both present', () => {
    mkdirSync(join(tmp, 'MyApp.xcodeproj'))
    mkdirSync(join(tmp, 'MyApp.xcworkspace'))
    const r = detectRepoKind(tmp)
    expect(r.kind).toBe('macos')
    expect(r.xcodeTarget).toBe(join(tmp, 'MyApp.xcworkspace'))
  })

  it('falls back to npx when no dev script', () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      dependencies: { next: '^16.0.0' },
    }))
    const r = detectRepoKind(tmp)
    expect(r.startCommand).toEqual(['npx', 'next', 'dev'])
  })

  it('throws LauncherError on missing path', () => {
    expect(() => detectRepoKind(join(tmp, 'nope'))).toThrow(LauncherError)
  })

  it('throws LauncherError on non-directory path', () => {
    const f = join(tmp, 'file.txt')
    writeFileSync(f, 'x')
    expect(() => detectRepoKind(f)).toThrow(LauncherError)
  })

  it('throws LauncherError when no launchable surface', () => {
    writeFileSync(join(tmp, 'README.md'), '# nothing here')
    expect(() => detectRepoKind(tmp)).toThrow(LauncherError)
  })

  it('throws LauncherError on malformed package.json', () => {
    writeFileSync(join(tmp, 'package.json'), '{not valid json}')
    expect(() => detectRepoKind(tmp)).toThrow(LauncherError)
  })
})
