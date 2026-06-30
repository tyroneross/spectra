import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAudioArgs, polishClip, polishScript } from '../../src/pipeline/polish.js'
import { ffmpegAvailable, makeTestVideo, probeVideo, runProcess } from './ffmpeg-helpers.js'

let workDir: string | null = null
const ffmpegIt = ffmpegAvailable ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-polish-'))
  return workDir
}

async function makeTestVideoWithAudio(path: string, width = 64, height = 36, durationSeconds = 0.5): Promise<void> {
  await runProcess('ffmpeg', [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `testsrc2=size=${width}x${height}:rate=60:duration=${durationSeconds}`,
    '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${durationSeconds}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-y',
    path,
  ])
}

async function probeHasAudioStream(path: string): Promise<boolean> {
  const stdout = await runProcess('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0',
    path,
  ]).catch(() => '')
  return stdout.trim().length > 0
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

  ffmpegIt('applies the spotlight pre-pass before zoom/framing when spotlight is set', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished-spotlight.mp4')
    await makeTestVideo(input, 480, 270, 0.25)

    const result = await polishClip({
      input,
      clicksJson: JSON.stringify([{ tMs: 80, cx: 0.5, cy: 0.5 }]),
      outPath,
      spotlight: {
        focal: { x: 120, y: 67, w: 240, h: 135 }, // middle 50% of 480x270
      },
    })

    expect(result).toMatchObject({
      outPath,
      width: 1920,
      height: 1080,
      fps: 60,
    })
    // The spotlight pre-pass is a temp file that polishClip owns end-to-end —
    // the final output is still a normal 1920x1080 mp4 like the non-spotlight path.
    await expect(probeVideo(outPath)).resolves.toMatchObject({
      width: 1920,
      height: 1080,
      fps: 60,
    })
  }, 30_000)

  ffmpegIt('produces an unchanged render when spotlight is omitted (backward-compatible default)', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished-no-spotlight.mp4')
    await makeTestVideo(input, 480, 270, 0.25)

    const result = await polishClip({
      input,
      clicksJson: JSON.stringify([{ tMs: 80, cx: 0.5, cy: 0.5 }]),
      outPath,
    })

    expect(result).toMatchObject({ outPath, width: 1920, height: 1080, fps: 60 })
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

describe('buildAudioArgs — arg-building branch (no ffmpeg needed)', () => {
  it('maps and preserves audio (AAC, trimmed to video length) when the input has audio', () => {
    expect(buildAudioArgs(true)).toEqual({
      mapArgs: ['-map', '0:a?'],
      codecArgs: ['-c:a', 'aac', '-shortest'],
    })
  })

  it('strips audio (-an) when the input has no audio, same as the prior unconditional behavior', () => {
    expect(buildAudioArgs(false)).toEqual({
      mapArgs: [],
      codecArgs: ['-an'],
    })
  })
})

describe('polishClip — audio passthrough', () => {
  ffmpegIt('preserves an audio stream when the input has one', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input-with-audio.mp4')
    const outPath = join(root, 'polished-with-audio.mp4')
    await makeTestVideoWithAudio(input, 64, 36, 0.5)
    expect(await probeHasAudioStream(input)).toBe(true)

    await polishClip({
      input,
      clicksJson: JSON.stringify([{ tMs: 80, cx: 0.35, cy: 0.45 }]),
      caption: 'With audio',
      outPath,
    })

    expect(await probeHasAudioStream(outPath)).toBe(true)
  }, 30_000)

  ffmpegIt('produces no audio stream when the input has none (unchanged behavior)', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input-silent.mp4')
    const outPath = join(root, 'polished-silent.mp4')
    await makeTestVideo(input, 64, 36, 0.25)
    expect(await probeHasAudioStream(input)).toBe(false)

    await polishClip({
      input,
      clicksJson: JSON.stringify([{ tMs: 80, cx: 0.35, cy: 0.45 }]),
      caption: 'No audio',
      outPath,
    })

    expect(await probeHasAudioStream(outPath)).toBe(false)
  }, 30_000)
})
