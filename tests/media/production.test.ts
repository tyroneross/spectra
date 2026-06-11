// tests/media/production.test.ts

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createProductionBundle } from '../../src/media/production.js'
import { encodePng, type RawImage } from '../../src/media/png.js'
import { resetProcessRunner, setProcessRunner, type ProcessRunner } from '../../src/media/pipeline.js'

let workDir: string | null = null

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-production-'))
  return workDir
}

function solidImage(width: number, height: number): RawImage {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = 20
    data[i * 4 + 1] = 80
    data[i * 4 + 2] = 160
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}

afterEach(async () => {
  resetProcessRunner()
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

function videoRunner(options: {
  probe?: unknown
  poster?: 'success' | 'fail'
}): ProcessRunner {
  return (cmd, args) => ({
    kill: () => {},
    waitForExit: async () => {
      if (cmd === 'ffmpeg' && options.poster !== 'fail') {
        await writeFile(args[args.length - 1], encodePng(solidImage(1280, 720)))
      }
      return cmd === 'ffmpeg' && options.poster === 'fail' ? 1 : 0
    },
    stdout: async () => cmd === 'ffprobe' && options.probe ? JSON.stringify(options.probe) : '',
    stderr: async () => 'poster failed',
  })
}

describe('createProductionBundle', () => {
  it('copies masters, creates PNG thumbnails, and writes manifests', async () => {
    const root = await makeWorkDir()
    const sourcePath = join(root, 'source.png')
    await writeFile(sourcePath, encodePng(solidImage(1600, 900)))

    const result = await createProductionBundle([
      {
        id: 'capture-1',
        path: sourcePath,
        type: 'screenshot',
        filename: 'source.png',
        preset: 'demo',
        caption: 'Main dashboard',
      },
    ], {
      outDir: join(root, 'bundle'),
      title: 'Launch Assets',
      createdAt: '2026-06-11T00:00:00.000Z',
      thumbnailMaxWidth: 320,
    })

    expect(result.manifest.title).toBe('Launch Assets')
    expect(result.manifest.quality.status).toBe('production-ready')
    expect(result.manifest.assets.map((asset) => asset.kind).sort()).toEqual(['master', 'thumbnail'])

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf-8'))
    expect(manifest.assets).toHaveLength(2)
    expect(manifest.assets[0].path).toBe('masters/001-source.png')
    expect(manifest.assets[1].width).toBe(320)

    await expect(stat(join(root, 'bundle', 'masters', '001-source.png'))).resolves.toBeDefined()
    await expect(stat(join(root, 'bundle', 'derivatives', '001-source-thumb.png'))).resolves.toBeDefined()
    await expect(stat(result.readmePath)).resolves.toBeDefined()
    await expect(stat(result.qualityReportPath)).resolves.toBeDefined()
  })

  it('marks sources without presets as review-needed', async () => {
    const root = await makeWorkDir()
    const sourcePath = join(root, 'small.png')
    await writeFile(sourcePath, encodePng(solidImage(400, 300)))

    const result = await createProductionBundle([
      {
        id: 'capture-2',
        path: sourcePath,
        type: 'screenshot',
        filename: 'small.png',
      },
    ], {
      outDir: join(root, 'bundle'),
      createdAt: '2026-06-11T00:00:00.000Z',
    })

    expect(result.manifest.quality.status).toBe('review-needed')
    expect(result.manifest.quality.checks.some((check) => check.code === 'preset-present' && check.level === 'warn')).toBe(true)
    expect(result.manifest.quality.checks.some((check) => check.code === 'image-resolution' && check.level === 'warn')).toBe(true)
  })

  it('uses inputPath for transformed media without leaking it into the manifest', async () => {
    const root = await makeWorkDir()
    const sourcePath = join(root, 'source.png')
    const transformedPath = join(root, 'source-cropped.png')
    await writeFile(sourcePath, encodePng(solidImage(1600, 900)))
    await writeFile(transformedPath, encodePng(solidImage(300, 200)))

    const result = await createProductionBundle([
      {
        id: 'capture-transformed',
        path: sourcePath,
        inputPath: transformedPath,
        type: 'screenshot',
        filename: 'source.png',
        preset: 'docs',
      },
    ], {
      outDir: join(root, 'bundle'),
      createdAt: '2026-06-11T00:00:00.000Z',
    })

    expect(result.manifest.sources[0].path).toBe(sourcePath)
    expect(result.manifest.sources[0]).not.toHaveProperty('inputPath')
    expect(result.manifest.assets.find((asset) => asset.kind === 'master')).toMatchObject({
      path: 'masters/001-source.png',
      width: 300,
      height: 200,
    })
  })

  it('rejects empty bundles', async () => {
    await expect(
      createProductionBundle([], { outDir: '/tmp/unused' }),
    ).rejects.toThrow(/at least one source/)
  })

  it('probes videos and creates poster derivatives', async () => {
    const root = await makeWorkDir()
    const sourcePath = join(root, 'demo.mp4')
    await writeFile(sourcePath, 'fake video bytes')
    setProcessRunner(videoRunner({
      probe: {
        streams: [{ codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30/1' }],
        format: { duration: '8.25' },
      },
      poster: 'success',
    }))

    const result = await createProductionBundle([
      {
        id: 'video-1',
        path: sourcePath,
        type: 'video',
        filename: 'demo.mp4',
        preset: 'demo',
      },
    ], {
      outDir: join(root, 'bundle'),
      createdAt: '2026-06-11T00:00:00.000Z',
    })

    expect(result.manifest.quality.status).toBe('production-ready')
    expect(result.manifest.assets.map((asset) => asset.kind).sort()).toEqual(['master', 'poster'])
    expect(result.manifest.assets[0]).toMatchObject({
      kind: 'master',
      width: 1920,
      height: 1080,
    })
    expect(result.manifest.sources[0].metadata).toMatchObject({
      video: {
        durationMs: 8250,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: 'h264',
      },
    })
    expect(result.manifest.quality.checks.some((check) => check.code === 'video-poster-generated' && check.level === 'pass')).toBe(true)
    await expect(stat(join(root, 'bundle', 'derivatives', '001-demo-poster.png'))).resolves.toBeDefined()
  })

  it('uses unique derivative names when source filenames repeat', async () => {
    const root = await makeWorkDir()
    const firstPath = join(root, 'first', 'capture.png')
    const secondPath = join(root, 'second', 'capture.png')
    await mkdir(join(root, 'first'), { recursive: true })
    await mkdir(join(root, 'second'), { recursive: true })
    await writeFile(firstPath, encodePng(solidImage(1200, 800)))
    await writeFile(secondPath, encodePng(solidImage(1200, 800)))

    const result = await createProductionBundle([
      { id: 'capture-a', path: firstPath, type: 'screenshot', filename: 'capture.png', preset: 'docs' },
      { id: 'capture-b', path: secondPath, type: 'screenshot', filename: 'capture.png', preset: 'docs' },
    ], {
      outDir: join(root, 'bundle'),
      createdAt: '2026-06-11T00:00:00.000Z',
    })

    const derivatives = result.manifest.assets
      .filter((asset) => asset.kind === 'thumbnail')
      .map((asset) => asset.path)

    expect(derivatives).toEqual([
      'derivatives/001-capture-thumb.png',
      'derivatives/002-capture-thumb.png',
    ])
  })

  it('keeps video bundles usable when probing or poster extraction fails', async () => {
    const root = await makeWorkDir()
    const sourcePath = join(root, 'rough.mp4')
    await writeFile(sourcePath, 'fake video bytes')
    setProcessRunner(videoRunner({ poster: 'fail' }))

    const result = await createProductionBundle([
      {
        id: 'video-2',
        path: sourcePath,
        type: 'video',
        filename: 'rough.mp4',
        preset: 'demo',
      },
    ], {
      outDir: join(root, 'bundle'),
      createdAt: '2026-06-11T00:00:00.000Z',
    })

    expect(result.manifest.assets.map((asset) => asset.kind)).toEqual(['master'])
    expect(result.manifest.quality.status).toBe('review-needed')
    expect(result.manifest.quality.checks.some((check) => check.code === 'video-probe' && check.level === 'warn')).toBe(true)
    expect(result.manifest.quality.checks.some((check) => check.code === 'video-poster-generated' && check.level === 'warn')).toBe(true)
  })
})
