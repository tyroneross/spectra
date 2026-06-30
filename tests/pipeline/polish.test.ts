import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { polishClip, polishScript } from '../../src/pipeline/polish.js'
import { ffmpegAvailable, makeTestVideo, probeVideo } from './ffmpeg-helpers.js'

let workDir: string | null = null
const ffmpegIt = ffmpegAvailable ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-polish-'))
  return workDir
}

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('polishClip', () => {
  ffmpegIt('composes zoom and framing into a 1920x1080 60fps mp4', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.25)

    const result = await polishClip({
      input,
      clicksJson: JSON.stringify([{ tMs: 80, cx: 0.35, cy: 0.45 }]),
      caption: 'Synthetic demo',
      outPath,
    })

    expect(result).toMatchObject({
      outPath,
      width: 1920,
      height: 1080,
      fps: 60,
    })
    await expect(probeVideo(outPath)).resolves.toMatchObject({
      width: 1920,
      height: 1080,
      fps: 60,
    })
  }, 30_000)

  ffmpegIt('honors a custom output fps throughout the polish pipeline', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished-30fps.mp4')
    await makeTestVideo(input, 64, 36, 0.25)

    const result = await polishClip({
      input,
      clicksJson: JSON.stringify([{ tMs: 80, cx: 0.35, cy: 0.45 }]),
      caption: 'Synthetic demo',
      outPath,
      fps: 30,
    })

    expect(result).toMatchObject({
      outPath,
      width: 1920,
      height: 1080,
      fps: 30,
    })
    await expect(probeVideo(outPath)).resolves.toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
    })
  }, 30_000)

  ffmpegIt('renders scripted polish with step cards at a custom output fps', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'scripted-30fps.mp4')
    await makeTestVideo(input, 64, 36, 0.25)

    const result = await polishScript({
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
      outPath,
      fps: 30,
    })

    expect(result).toMatchObject({
      outPath,
      width: 1920,
      height: 1080,
      fps: 30,
    })
    await expect(probeVideo(outPath)).resolves.toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
    })
  }, 30_000)
})
