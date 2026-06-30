// tests/mcp/demo.test.ts
//
// Covers the spectra_demo MCP tool's action dispatch, with focus on the
// polish-clip / polish-script actions that reach the rich polish pipeline
// (src/pipeline/polish.ts). Schema-validation tests run unconditionally;
// the end-to-end render tests are ffmpeg-gated like tests/pipeline/polish.test.ts.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DemoSchema, handleDemo } from '../../src/mcp/tools/demo.js'
import { ffmpegAvailable, makeTestVideo, probeVideo } from '../pipeline/ffmpeg-helpers.js'

let workDir: string | null = null
const ffmpegIt = ffmpegAvailable ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-demo-tool-'))
  return workDir
}

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('DemoSchema — polish-clip / polish-script validation', () => {
  it('accepts a polish-clip action with an inline click array', () => {
    const result = DemoSchema.safeParse({
      action: 'polish-clip',
      input: '/tmp/input.mp4',
      clicksJson: [{ tMs: 100, cx: 0.5, cy: 0.5 }],
      caption: 'Hello',
      out: '/tmp/out.mp4',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a polish-script action with a multi-beat script', () => {
    const result = DemoSchema.safeParse({
      action: 'polish-script',
      input: '/tmp/input.mp4',
      script: {
        finalCaption: 'Done',
        beats: [
          { id: 'a', startMs: 0, endMs: 1000, action: { kind: 'hold' } },
        ],
      },
      out: '/tmp/out.mp4',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown action', () => {
    const result = DemoSchema.safeParse({ action: 'polish-video', input: '/tmp/input.mp4', out: '/tmp/out.mp4' })
    expect(result.success).toBe(false)
  })

  it('rejects polish-clip missing the out path', () => {
    const result = DemoSchema.safeParse({
      action: 'polish-clip',
      input: '/tmp/input.mp4',
      clicksJson: '/tmp/clicks.json',
    })
    expect(result.success).toBe(false)
  })
})

describe('handleDemo — polish-clip / polish-script reach the rich pipeline', () => {
  ffmpegIt('polish-clip produces a 1920x1080 60fps mp4 with a caption banner', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.25)

    const result = (await handleDemo({
      action: 'polish-clip',
      input,
      clicksJson: [{ tMs: 80, cx: 0.35, cy: 0.45 }],
      caption: 'From the MCP tool',
      out: outPath,
    })) as { outPath: string; width: number; height: number; fps: number }

    expect(result).toMatchObject({ outPath, width: 1920, height: 1080, fps: 60 })
    await expect(probeVideo(outPath)).resolves.toMatchObject({ width: 1920, height: 1080, fps: 60 })
  }, 30_000)

  ffmpegIt('polish-script produces a 1920x1080 mp4 at a custom fps', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'scripted.mp4')
    await makeTestVideo(input, 64, 36, 0.25)

    const result = (await handleDemo({
      action: 'polish-script',
      input,
      script: {
        finalCaption: 'Done',
        beats: [
          {
            id: 'intro',
            stepLabel: '1',
            stepText: 'Search fast',
            startMs: 0,
            endMs: 250,
            zoom: { cx: 0.35, cy: 0.45, scale: 1.25 },
            action: { kind: 'search', value: 'demo' },
          },
        ],
      },
      out: outPath,
      fps: 30,
    })) as { outPath: string; width: number; height: number; fps: number }

    expect(result).toMatchObject({ outPath, width: 1920, height: 1080, fps: 30 })
    await expect(probeVideo(outPath)).resolves.toMatchObject({ width: 1920, height: 1080, fps: 30 })
  }, 30_000)
})
