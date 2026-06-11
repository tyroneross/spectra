import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFileBytes = vi.hoisted(() => new Map<string, string>())

// Mock node:fs/promises at top level — hoisted by vitest
vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  copyFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  utimes: vi.fn().mockResolvedValue(undefined),
}))

// Mock node:fs for contentHash stream (used in listCaptures)
vi.mock('node:fs', () => ({
  createReadStream: vi.fn().mockImplementation((path: unknown) => ({
    on(event: string, callback: (chunk?: Buffer) => void) {
      if (event === 'data') {
        queueMicrotask(() => callback(Buffer.from(mockFileBytes.get(String(path)) ?? 'duplicate-media-bytes')))
      }
      if (event === 'end') queueMicrotask(() => callback())
      return this
    },
  })),
  existsSync: vi.fn().mockReturnValue(true),
}))

import * as fsp from 'node:fs/promises'
import {
  getProductionBundle,
  importCaptureCandidates,
  listCaptureImportCandidates,
  listCaptures,
  listPlaybookRecommendations,
  listProductionBundles,
  listSessions,
  resolveMediaPath,
} from '../../lib/data.js'

const mockedAccess = vi.mocked(fsp.access)
const mockedCopyFile = vi.mocked(fsp.copyFile)
const mockedMkdir = vi.mocked(fsp.mkdir)
const mockedReaddir = vi.mocked(fsp.readdir)
const mockedReadFile = vi.mocked(fsp.readFile)
const mockedStat = vi.mocked(fsp.stat)
const mockedUtimes = vi.mocked(fsp.utimes)

beforeEach(() => {
  mockFileBytes.clear()
})

function mockDirent(name: string, kind: 'file' | 'directory') {
  return Object.assign(Object.create(null), {
    name,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
  })
}

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

  it('rejects sibling paths that only share an allowed prefix', () => {
    expect(resolveMediaPath('artifacts-old/screenshot.png')).toBeNull()
    expect(resolveMediaPath('.spectra-backup/sessions/abc123/step-001.png')).toBeNull()
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

  it('uses unique IDs for duplicate media bytes in different paths', async () => {
    mockedReaddir.mockImplementation((dir: unknown, opts?: unknown) => {
      const dirStr = String(dir)
      const withFileTypes = (opts as { withFileTypes?: boolean } | undefined)?.withFileTypes

      if (dirStr.endsWith('artifacts')) {
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      }
      if (dirStr.endsWith('sessions') && withFileTypes) {
        return Promise.resolve([
          mockDirent('sess-a', 'directory'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.includes('sess-a') && withFileTypes) {
        return Promise.resolve([
          mockDirent('session.json', 'file'),
          mockDirent('step-000.png', 'file'),
          mockDirent('step-001.png', 'file'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    mockedReadFile.mockResolvedValue(JSON.stringify({
      id: 'sess-a',
      name: 'Duplicate Session',
      platform: 'web',
      target: { url: 'https://example.com' },
      steps: [
        { index: 0, intent: 'click first duplicate', screenshotPath: 'step-000.png' },
        { index: 1, intent: 'click second duplicate', screenshotPath: 'step-001.png' },
      ],
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    }) as unknown as Awaited<ReturnType<typeof fsp.readFile>>)
    mockedStat.mockResolvedValue({ size: 1024, mtimeMs: 1700000000000 } as unknown as Awaited<ReturnType<typeof fsp.stat>>)

    const result = await listCaptures()
    expect(result).toHaveLength(2)
    expect(new Set(result.map((capture) => capture.id)).size).toBe(2)
    expect(result.map((capture) => capture.guide).sort()).toEqual([
      'click first duplicate',
      'click second duplicate',
    ])
    expect(result.every((capture) => capture.projectName === capture.repoName)).toBe(true)
    expect(result.every((capture) => capture.sessionType === 'Duplicate Session')).toBe(true)
    expect(result[0].guideDetails).toEqual(expect.arrayContaining([
      'Session type: Duplicate Session',
      'Tools: spectra_step -> spectra_capture',
      'Planner: unknown',
    ]))
  })

  it('exposes production preset metadata from session run artifacts', async () => {
    mockedReaddir.mockImplementation((dir: unknown, opts?: unknown) => {
      const dirStr = String(dir)
      const withFileTypes = (opts as { withFileTypes?: boolean } | undefined)?.withFileTypes

      if (dirStr.endsWith('artifacts')) {
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      }
      if (dirStr.endsWith('sessions') && withFileTypes) {
        return Promise.resolve([
          mockDirent('sess-production', 'directory'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.includes('sess-production') && withFileTypes) {
        return Promise.resolve([
          mockDirent('session.json', 'file'),
          mockDirent('capture.png', 'file'),
          mockDirent('run.json', 'file'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    mockedReadFile.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      if (pathStr.endsWith('run.json')) {
        return Promise.resolve(JSON.stringify({
          name: 'Production Run',
          planner: { source: 'host-agent' },
          recording: { state: 'idle' },
          artifacts: [
            {
              id: 'artifact-1',
              type: 'screenshot',
              path: 'capture.png',
              label: 'Full screen',
              createdAt: 1700000000000,
              metadata: {
                preset: 'demo',
                productionReady: true,
              },
            },
          ],
        })) as unknown as ReturnType<typeof fsp.readFile>
      }
      return Promise.resolve(JSON.stringify({
        id: 'sess-production',
        name: 'Production Session',
        platform: 'web',
        target: { url: 'https://example.com' },
        steps: [],
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
      })) as unknown as ReturnType<typeof fsp.readFile>
    })
    mockedStat.mockResolvedValue({ size: 4096, mtimeMs: 1700000000000 } as unknown as Awaited<ReturnType<typeof fsp.stat>>)

    const result = await listCaptures()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      filename: 'capture.png',
      preset: 'demo',
      productionReady: true,
      guide: 'Full screen',
    })
  })

  it('groups artifact captures by canonical project name and filters by project', async () => {
    mockedReaddir.mockImplementation((dir: unknown, opts?: unknown) => {
      const dirStr = String(dir)
      const withFileTypes = (opts as { withFileTypes?: boolean } | undefined)?.withFileTypes

      if (dirStr.endsWith('artifacts') && withFileTypes) {
        return Promise.resolve([
          mockDirent('atomize-ai', 'directory'),
          mockDirent('flodoro', 'directory'),
          mockDirent('sim-test-2026-03-18', 'directory'),
          mockDirent('desktop-full.png', 'file'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.endsWith('artifacts/atomize-ai') && withFileTypes) {
        return Promise.resolve([
          mockDirent('sign-up.png', 'file'),
          mockDirent('sign-up-framed.png', 'file'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.endsWith('artifacts/flodoro') && withFileTypes) {
        return Promise.resolve([
          mockDirent('01-idle.png', 'file'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.endsWith('artifacts/sim-test-2026-03-18') && withFileTypes) {
        return Promise.resolve([
          mockDirent('01-flowdoro-before.png', 'file'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.endsWith('sessions')) {
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })
    mockedStat.mockResolvedValue({ size: 2048, mtimeMs: 1700000000000 } as unknown as Awaited<ReturnType<typeof fsp.stat>>)

    const atomize = await listCaptures({ project: 'Atomize AI' })
    const truePace = await listCaptures({ project: 'TruePace' })
    const unknown = await listCaptures({ project: 'Unknown' })

    expect(atomize).toHaveLength(1)
    expect(atomize[0]).toMatchObject({
      filename: 'sign-up.png',
      projectName: 'Atomize AI',
      productName: 'Atomize AI',
    })
    expect(atomize[0].guideDetails).toEqual([
      'Project: Atomize AI',
      'Source: artifacts folder',
      expect.stringContaining('artifacts/atomize-ai/sign-up.png'),
    ])
    expect(truePace.map((capture) => capture.filename).sort()).toEqual([
      '01-flowdoro-before.png',
      '01-idle.png',
    ])
    expect(unknown.map((capture) => capture.filename).sort()).toEqual([
      'desktop-full.png',
      'sign-up-framed.png',
    ])
  })
})

// ─── capture imports — sibling repo discovery + copy ────────────────────────

describe('capture imports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mockImportFilesystem() {
    mockedAccess.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      if (pathStr.endsWith('/atomize-ai/.git')) return Promise.resolve() as unknown as ReturnType<typeof fsp.access>
      if (pathStr.endsWith('/atomize-ai/artifacts')) return Promise.resolve() as unknown as ReturnType<typeof fsp.access>
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    mockedReaddir.mockImplementation((dir: unknown, opts?: unknown) => {
      const dirStr = String(dir)
      const withFileTypes = (opts as { withFileTypes?: boolean } | undefined)?.withFileTypes

      if (dirStr.endsWith('/git-folder') && withFileTypes) {
        return Promise.resolve([
          mockDirent('spectra', 'directory'),
          mockDirent('atomize-ai', 'directory'),
          mockDirent('notes', 'directory'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.includes('/git-folder/atomize-ai/artifacts') && !dirStr.includes('/spectra/artifacts') && withFileTypes) {
        return Promise.resolve([
          mockDirent('dashboard.png', 'file'),
          mockDirent('notes.txt', 'file'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    mockedStat.mockResolvedValue({
      size: 4096,
      mtimeMs: 1700000000000,
      atime: new Date(1700000000000),
      mtime: new Date(1700000000000),
    } as unknown as Awaited<ReturnType<typeof fsp.stat>>)
  }

  it('discovers importable media from sibling repo artifacts', async () => {
    mockImportFilesystem()

    const result = await listCaptureImportCandidates()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      repoName: 'atomize-ai',
      sourceType: 'artifacts',
      destinationProject: 'atomize-ai',
      destinationRoot: 'artifacts/atomize-ai/artifacts',
      fileCount: 1,
      totalSize: 4096,
      alreadyImported: false,
    })
  })

  it('copies selected imports into the central Spectra artifacts folder', async () => {
    mockImportFilesystem()
    const candidates = await listCaptureImportCandidates()

    const result = await importCaptureCandidates([candidates[0].id])

    expect(result).toEqual([
      expect.objectContaining({
        candidateId: candidates[0].id,
        repoName: 'atomize-ai',
        sourceType: 'artifacts',
        destinationRoot: 'artifacts/atomize-ai/artifacts',
        copied: 1,
        skipped: 0,
        errors: [],
      }),
    ])
    expect(mockedMkdir).toHaveBeenCalled()
    expect(mockedCopyFile).toHaveBeenCalledTimes(1)
    expect(String(mockedCopyFile.mock.calls[0][1])).toContain('/artifacts/atomize-ai/artifacts/dashboard.png')
    expect(mockedUtimes).toHaveBeenCalledTimes(1)
  })

  it('does not mark imports as fresh when destination count matches but bytes differ', async () => {
    mockImportFilesystem()
    mockedAccess.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      if (pathStr.endsWith('/atomize-ai/.git')) return Promise.resolve() as unknown as ReturnType<typeof fsp.access>
      if (pathStr.endsWith('/atomize-ai/artifacts')) return Promise.resolve() as unknown as ReturnType<typeof fsp.access>
      if (pathStr.endsWith('/spectra/artifacts/atomize-ai/artifacts/dashboard.png')) return Promise.resolve() as unknown as ReturnType<typeof fsp.access>
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })
    mockedReaddir.mockImplementation((dir: unknown, opts?: unknown) => {
      const dirStr = String(dir)
      const withFileTypes = (opts as { withFileTypes?: boolean } | undefined)?.withFileTypes

      if (dirStr.endsWith('/git-folder') && withFileTypes) {
        return Promise.resolve([
          mockDirent('spectra', 'directory'),
          mockDirent('atomize-ai', 'directory'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.endsWith('/git-folder/atomize-ai/artifacts') && withFileTypes) {
        return Promise.resolve([mockDirent('dashboard.png', 'file')]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.endsWith('/git-folder/spectra/artifacts/atomize-ai/artifacts') && withFileTypes) {
        return Promise.resolve([mockDirent('dashboard.png', 'file')]) as unknown as ReturnType<typeof fsp.readdir>
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })
    mockFileBytes.set('/Users/tyroneross/dev/git-folder/atomize-ai/artifacts/dashboard.png', 'new bytes')
    mockFileBytes.set('/Users/tyroneross/dev/git-folder/spectra/artifacts/atomize-ai/artifacts/dashboard.png', 'old bytes')

    const result = await listCaptureImportCandidates()

    expect(result).toHaveLength(1)
    expect(result[0].alreadyImported).toBe(false)
  })
})

// ─── production bundles — filesystem interaction ───────────────────────────

describe('listProductionBundles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads production bundle manifests from .spectra/productions', async () => {
    mockedReaddir.mockImplementation((dir: unknown, opts?: unknown) => {
      const dirStr = String(dir)
      const withFileTypes = (opts as { withFileTypes?: boolean } | undefined)?.withFileTypes

      if (dirStr.endsWith('.spectra/productions') && withFileTypes) {
        return Promise.resolve([mockDirent('bundle-a', 'directory')]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.endsWith('.spectra/productions/bundle-a') && withFileTypes) {
        return Promise.resolve([
          mockDirent('manifest.json', 'file'),
          mockDirent('quality-report.json', 'file'),
          mockDirent('README.md', 'file'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })
    mockedAccess.mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof fsp.access>>)
    mockedReadFile.mockResolvedValue(JSON.stringify({
      schemaVersion: 1,
      title: 'Spectra docs bundle',
      createdAt: '2026-06-10T18:00:00.000Z',
      preset: 'docs',
      sources: [
        { id: 'source-1', path: '/private/source.png', type: 'screenshot' },
      ],
      assets: [
        { id: 'asset-1', sourceId: 'source-1', kind: 'master', path: 'masters/source.png', format: 'png', sizeBytes: 1200 },
        { id: 'asset-2', sourceId: 'source-1', kind: 'thumbnail', path: 'derivatives/source-thumb.png', format: 'png', sizeBytes: 400 },
      ],
      quality: {
        status: 'production-ready',
        score: 100,
        checks: [],
      },
    }) as unknown as Awaited<ReturnType<typeof fsp.readFile>>)
    mockedStat.mockResolvedValue({ size: 2048, mtimeMs: 1781114400000 } as unknown as Awaited<ReturnType<typeof fsp.stat>>)

    const result = await listProductionBundles()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      title: 'Spectra docs bundle',
      preset: 'docs',
      status: 'production-ready',
      score: 100,
      assetCount: 2,
      sourceCount: 1,
      totalSize: 1600,
      path: '.spectra/productions/bundle-a',
      manifestPath: '.spectra/productions/bundle-a/manifest.json',
      readmePath: '.spectra/productions/bundle-a/README.md',
      qualityReportPath: '.spectra/productions/bundle-a/quality-report.json',
    })
    expect(result[0].id).toHaveLength(16)

    const detail = await getProductionBundle(result[0].id)
    expect(detail).toMatchObject({
      id: result[0].id,
      title: 'Spectra docs bundle',
      manifest: {
        title: 'Spectra docs bundle',
        assets: [
          expect.objectContaining({ kind: 'master', path: 'masters/source.png' }),
          expect.objectContaining({ kind: 'thumbnail', path: 'derivatives/source-thumb.png' }),
        ],
      },
    })
    expect(await getProductionBundle('missing-bundle')).toBeNull()
  })
})

// ─── listPlaybookRecommendations — repeated session flows ───────────────────

describe('listPlaybookRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drafts a playbook from a repeated successful session flow', async () => {
    mockedReaddir.mockImplementation((dir: unknown, opts?: unknown) => {
      const dirStr = String(dir)
      const withFileTypes = (opts as { withFileTypes?: boolean } | undefined)?.withFileTypes

      if (dirStr.endsWith('playbooks')) {
        return Promise.resolve([]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.endsWith('sessions') && withFileTypes) {
        return Promise.resolve([
          mockDirent('sess-a', 'directory'),
          mockDirent('sess-b', 'directory'),
          mockDirent('sess-c', 'directory'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if ((dirStr.includes('sess-a') || dirStr.includes('sess-b') || dirStr.includes('sess-c')) && withFileTypes) {
        return Promise.resolve([mockDirent('session.json', 'file')]) as unknown as ReturnType<typeof fsp.readdir>
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    mockedReadFile.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      if (pathStr.endsWith('run.json')) {
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      }

      const base = {
        name: 'Cross Agent Walkthrough',
        platform: 'web',
        target: { url: 'http://127.0.0.1:3000' },
        createdAt: 1700000000000,
        closedAt: 1700000001000,
      }
      const repeatedSteps = [
        { index: 0, intent: 'click Open Sessions', success: true, screenshotPath: 'step-000.png', timestamp: 1700000000100 },
        { index: 1, intent: 'click Open Export', success: true, screenshotPath: 'step-001.png', timestamp: 1700000000200 },
        { index: 2, intent: 'click Open Guidance', success: true, screenshotPath: 'step-002.png', timestamp: 1700000000300 },
      ]

      if (pathStr.includes('sess-a')) {
        return Promise.resolve(JSON.stringify({ ...base, id: 'sess-a', steps: repeatedSteps, updatedAt: 1700000001000 })) as unknown as ReturnType<typeof fsp.readFile>
      }
      if (pathStr.includes('sess-b')) {
        return Promise.resolve(JSON.stringify({ ...base, id: 'sess-b', steps: repeatedSteps, updatedAt: 1700000002000 })) as unknown as ReturnType<typeof fsp.readFile>
      }
      return Promise.resolve(JSON.stringify({
        ...base,
        id: 'sess-c',
        name: 'Single Flow',
        steps: [{ index: 0, intent: 'click Settings', success: true, screenshotPath: 'step-000.png', timestamp: 1700000000100 }],
        updatedAt: 1700000003000,
      })) as unknown as ReturnType<typeof fsp.readFile>
    })

    const result = await listPlaybookRecommendations()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'Cross Agent Walkthrough',
      platform: 'web',
      target: 'http://127.0.0.1:3000',
      occurrences: 2,
    })
    expect(result[0].steps.map((step) => step.intent)).toEqual([
      'click Open Sessions',
      'click Open Export',
      'click Open Guidance',
    ])
    expect(result[0].steps.every((step) => step.captureType === 'screenshot')).toBe(true)
    expect(result[0].evidence.map((e) => e.sessionId)).toEqual(['sess-b', 'sess-a'])
  })

  it('preserves repeated video start and stop semantics in recommendations', async () => {
    mockedReaddir.mockImplementation((dir: unknown, opts?: unknown) => {
      const dirStr = String(dir)
      const withFileTypes = (opts as { withFileTypes?: boolean } | undefined)?.withFileTypes

      if (dirStr.endsWith('playbooks')) {
        return Promise.resolve([]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.endsWith('sessions') && withFileTypes) {
        return Promise.resolve([
          mockDirent('sess-a', 'directory'),
          mockDirent('sess-b', 'directory'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if ((dirStr.includes('sess-a') || dirStr.includes('sess-b')) && withFileTypes) {
        return Promise.resolve([mockDirent('session.json', 'file'), mockDirent('run.json', 'file')]) as unknown as ReturnType<typeof fsp.readdir>
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    mockedReadFile.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      const sessionId = pathStr.includes('sess-a') ? 'sess-a' : 'sess-b'
      if (pathStr.endsWith('run.json')) {
        return Promise.resolve(JSON.stringify({
          name: 'Demo Recording',
          planner: { source: 'host-agent' },
          recording: {
            state: 'saved',
            startedAt: 1700000000050,
            stoppedAt: 1700000000300,
            path: 'video.mp4',
          },
          events: [
            { id: 'recording', timestamp: 1700000000050, type: 'recording.status', summary: 'recording recording', data: { state: 'recording' } },
            { id: 'saved', timestamp: 1700000000300, type: 'recording.status', summary: 'recording saved', data: { state: 'saved' } },
          ],
          artifacts: [],
          actions: [],
          decisions: [],
        })) as unknown as ReturnType<typeof fsp.readFile>
      }
      return Promise.resolve(JSON.stringify({
        id: sessionId,
        name: 'Demo Recording',
        platform: 'web',
        target: { url: 'http://127.0.0.1:3000' },
        steps: [
          { index: 0, intent: 'click Start Demo', success: true, screenshotPath: 'step-000.png', timestamp: 1700000000100 },
        ],
        createdAt: 1700000000000,
        updatedAt: sessionId === 'sess-a' ? 1700000001000 : 1700000002000,
      })) as unknown as ReturnType<typeof fsp.readFile>
    })

    const result = await listPlaybookRecommendations()

    expect(result).toHaveLength(1)
    expect(result[0].steps.map((step) => step.captureType)).toEqual([
      'video_start',
      'screenshot',
      'video_stop',
    ])
  })

  it('does not recommend a repeated flow that already exists as a playbook', async () => {
    const repeatedSteps = [
      { intent: 'click Open Sessions', captureType: 'screenshot' as const },
      { intent: 'click Open Export', captureType: 'screenshot' as const },
    ]

    mockedReaddir.mockImplementation((dir: unknown, opts?: unknown) => {
      const dirStr = String(dir)
      const withFileTypes = (opts as { withFileTypes?: boolean } | undefined)?.withFileTypes

      if (dirStr.endsWith('playbooks')) {
        return Promise.resolve([mockDirent('saved.json', 'file')]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if (dirStr.endsWith('sessions') && withFileTypes) {
        return Promise.resolve([
          mockDirent('sess-a', 'directory'),
          mockDirent('sess-b', 'directory'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      if ((dirStr.includes('sess-a') || dirStr.includes('sess-b')) && withFileTypes) {
        return Promise.resolve([mockDirent('session.json', 'file')]) as unknown as ReturnType<typeof fsp.readdir>
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    mockedReadFile.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      if (pathStr.endsWith('run.json')) {
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      }
      if (pathStr.endsWith('saved.json')) {
        return Promise.resolve(JSON.stringify({
          id: 'saved',
          name: 'Saved Walkthrough',
          description: '',
          target: 'http://localhost:3000',
          platform: 'web',
          steps: repeatedSteps,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        })) as unknown as ReturnType<typeof fsp.readFile>
      }

      return Promise.resolve(JSON.stringify({
        id: pathStr.includes('sess-a') ? 'sess-a' : 'sess-b',
        name: 'Cross Agent Walkthrough',
        platform: 'web',
        target: { url: 'http://127.0.0.1:3000' },
        steps: repeatedSteps.map((step, index) => ({
          index,
          intent: step.intent,
          success: true,
          screenshotPath: `step-00${index}.png`,
          timestamp: 1700000000100 + index,
        })),
        createdAt: 1700000000000,
        updatedAt: pathStr.includes('sess-a') ? 1700000001000 : 1700000002000,
      })) as unknown as ReturnType<typeof fsp.readFile>
    })

    const result = await listPlaybookRecommendations()
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

  it('reads session.json and counts session media files for captureCount', async () => {
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
          mockDirent('sess-abc', 'directory'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      // Session folder recursive media scan.
      if (dirStr.includes('sess-abc') && withFileTypes) {
        return Promise.resolve([
          mockDirent('session.json', 'file'),
          mockDirent('step-001.png', 'file'),
        ]) as unknown as ReturnType<typeof fsp.readdir>
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    mockedReadFile.mockResolvedValue(JSON.stringify(mockSession) as unknown as Awaited<ReturnType<typeof fsp.readFile>>)
    mockedStat.mockResolvedValue({ size: 1024, mtimeMs: 1700000000000 } as unknown as Awaited<ReturnType<typeof fsp.stat>>)

    const result = await listSessions()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sess-abc')
    expect(result[0].name).toBe('Test Session')
    expect(result[0].platform).toBe('web')
    expect(result[0].captureCount).toBe(1)
    expect(result[0].status).toBe('active')
    expect(result[0].projectName).toBeDefined()
    expect(result[0].sessionType).toBe('Test Session')
  })
})
