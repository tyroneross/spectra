import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildMixedAudioArgs, polishScript } from '../../src/pipeline/polish.js'
import { ffmpegAvailable, makeTestVideo, runProcess } from './ffmpeg-helpers.js'

let workDir: string | null = null
const ffmpegIt = ffmpegAvailable ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-mixed-audio-'))
  return workDir
}

async function makeTone(path: string, frequency: number, durationSec: number): Promise<void> {
  await runProcess('ffmpeg', [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=${durationSec}`,
    '-c:a', 'pcm_s16le',
    '-y',
    path,
  ])
}

async function probeAudio(path: string): Promise<{ codec: string; durationSec: number }> {
  const raw = await runProcess('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,duration:format=duration',
    '-of', 'json',
    path,
  ])
  const data = JSON.parse(raw) as {
    streams?: Array<{ codec_name?: string; duration?: string }>
    format?: { duration?: string }
  }
  const codec = data.streams?.[0]?.codec_name
  const durationSec = Number(data.streams?.[0]?.duration ?? data.format?.duration)
  if (!codec || !Number.isFinite(durationSec)) {
    throw new Error(`Could not probe mixed audio output ${path}`)
  }
  return { codec, durationSec }
}

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('layered audio — generated ffmpeg inputs', () => {
  ffmpegIt('executes the mixed graph with generated silence, music, and SFX', async () => {
    const root = await makeWorkDir()
    const music = join(root, 'music.wav')
    const sfx = join(root, 'sfx.wav')
    const outPath = join(root, 'mixed.m4a')
    await makeTone(music, 220, 0.5)
    await makeTone(sfx, 880, 0.08)

    const audio = buildMixedAudioArgs({
      music,
      sfx: [{ atMs: 125, file: sfx }],
      base: { kind: 'source' },
      nextInputIndex: 1,
      videoDurationSec: 0.5,
    })

    await runProcess('ffmpeg', [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'anullsrc=channel_layout=mono:sample_rate=48000:d=0.5',
      ...audio.inputArgs,
      '-filter_complex', audio.filter,
      ...audio.mapArgs,
      ...audio.codecArgs,
      '-y',
      outPath,
    ])

    const result = await probeAudio(outPath)
    expect(result.codec).toBe('aac')
    expect(result.durationSec).toBeCloseTo(0.5, 1)
  }, 30_000)

  ffmpegIt('renders a generated per-beat sound cue through polishScript', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const sfx = join(root, 'beat-sfx.wav')
    const outPath = join(root, 'polished-with-beat-sfx.mp4')
    await makeTestVideo(input, 64, 36, 0.35)
    await makeTone(sfx, 660, 0.08)

    const result = await polishScript({
      input,
      script: {
        beats: [
          {
            id: 'cue',
            startMs: 100,
            endMs: 300,
            sound: { file: sfx, offsetMs: 25 },
          },
        ],
      },
      outPath,
      fps: 30,
    })

    expect(result).toMatchObject({ outPath, width: 1920, height: 1080, fps: 30 })
    const audio = await probeAudio(outPath)
    expect(audio.codec).toBe('aac')
    expect(audio.durationSec).toBeCloseTo(result.frames / result.fps, 1)
  }, 30_000)
})
