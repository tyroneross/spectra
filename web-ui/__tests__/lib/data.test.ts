import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock node:fs/promises at top level — hoisted by vitest
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

// Mock node:fs for contentHash stream (used in listCaptures)
vi.mock('node:fs', () => ({
  createReadStream: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
  }),
  existsSync: vi.fn().mockReturnValue(true),
}))

import * as fsp from 'node:fs/promises'
import { resolveMediaPath, listCaptures, listSessions } from '../../lib/data.js'

const mockedReaddir = vi.mocked(fsp.readdir)
const mockedReadFile = vi.mocked(fsp.readFile)
const mockedStat = vi.mocked(fsp.stat)

// ─── resolveMediaPath — pure, no fs calls ────────────────────────────────────

describe('resolveMediaPath', () => {
  it('returns null for paths containing ".."', () => {
    expect(resolveMediaPath('../etc/passwd')).toBeNull()
    expect(resolveMediaPath('artifacts/../../etc/passwd')).toBeNull()
    expect(resolveMediaPath('.spectra/../../../sensitive')).toBeNull()
  })

  it('returns a string for valid artifacts paths', () => {
    const result = resolveMediaPath('artifacts/screenshot.png')
    expect(result).toBeTypeOf('string')
    expect(result).toContain('artifacts')
    expect(result).toContain('screenshot.png')
  })

  it('returns a string for valid .spectra paths', () => {
    const result = resolveMediaPath('.spectra/sessions/abc123/step-001.png')
    expect(result).toBeTypeOf('string')
    expect(result).toContain('step-001.png')
  })

  it('returns null for paths outside allowed directories', () => {
    const result = resolveMediaPath('some/other/dir/file.png')
    expect(result).toBeNull()
  })
})

// ─── listCaptures — filesystem interaction ───────────────────────────────────

describe('listCaptures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when artifacts/ and sessions/ directories are missing', async () => {
    mockedReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await listCaptures()
    expect(result).toEqual([])
  })
})

// ─── listSessions — filesystem interaction ───────────────────────────────────

describe('listSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when sessions/ directory is missing', async () => {
    mockedReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await listSessions()
    expect(result).toEqual([])
  })

  it('reads session.json and counts step-*.png files for captureCount', async () => {
    const mockSession = {
      id: 'sess-abc',
      name: 'Test Session',
      platform: 'web',
      target: { url: 'https://example.com' },
      steps: [],
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    }

    mockedReaddir.mockImplementation((dir: unknown, opts?: unknown) => {
      const dirStr = String(dir)
      const withFileTypes = (opts as { withFileTypes?: boolean } | undefined)?.withFileTypes

      // Sessions directory — return one session folder (withFileTypes: true)
      if (dirStr.includes('sessions') && !dirStr.includes('sess-abc')) {
        return Promise.resolve([
          Object.assign(Object.create(null), {
            name: 'sess-abc',
            isDirectory: () => true,
            isFile: () => false,
          }),
        ]) as ReturnType<typeof fsp.readdir>
      }
      // Session folder listing for captureCount (no withFileTypes — returns string[])
      if (dirStr.includes('sess-abc') && !withFileTypes) {
        return Promise.resolve(['session.json', 'step-001.png']) as ReturnType<typeof fsp.readdir>
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    mockedReadFile.mockResolvedValue(JSON.stringify(mockSession) as unknown as Buffer)
    mockedStat.mockResolvedValue({ size: 1024, mtimeMs: 1700000000000 } as unknown as Awaited<ReturnType<typeof fsp.stat>>)

    const result = await listSessions()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sess-abc')
    expect(result[0].name).toBe('Test Session')
    expect(result[0].platform).toBe('web')
    expect(result[0].captureCount).toBe(1)
    expect(result[0].status).toBe('active')
  })
})
