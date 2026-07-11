import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAudioArgs, buildMixedAudioArgs, buildVoiceoverAudioArgs, finalCaptionWindow, polishClip, polishScript } from '../../src/pipeline/polish.js'
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

async function makeVoiceover(path: string, durationSeconds: number): Promise<void> {
  await runProcess('ffmpeg', [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${durationSeconds}`,
    '-c:a', 'aac',
    '-y',
    path,
  ])
}

async function probeAudioCodec(path: string): Promise<string> {
  const stdout = await runProcess('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name',
    '-of', 'csv=p=0',
    path,
  ]).catch(() => '')
  return stdout.trim()
}

async function probeStreamDurationSec(path: string, stream: 'v:0' | 'a:0'): Promise<number> {
  const stdout = await runProcess('ffprobe', [
    '-v', 'error',
    '-select_streams', stream,
    '-show_entries', 'stream=duration:format=duration',
    '-of', 'json',
    path,
  ])
  const data = JSON.parse(stdout) as {
    streams?: Array<{ duration?: string }>
    format?: { duration?: string }
  }
  const raw = data.streams?.[0]?.duration ?? data.format?.duration
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) throw new Error(`Could not probe ${stream} duration for ${path}`)
  return parsed
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
  it('maps and preserves audio (AAC, padded with -af apad, trimmed to video length) when the input has audio', () => {
    expect(buildAudioArgs(true)).toEqual({
      mapArgs: ['-map', '0:a?'],
      codecArgs: ['-c:a', 'aac', '-af', 'apad', '-shortest'],
    })
  })

  it('pads audio (-af apad) before -shortest so a short source audio track never truncates the video', () => {
    const { codecArgs } = buildAudioArgs(true)
    const apadIdx = codecArgs.indexOf('-af')
    const shortestIdx = codecArgs.indexOf('-shortest')
    expect(apadIdx).toBeGreaterThan(-1)
    expect(codecArgs[apadIdx + 1]).toBe('apad')
    expect(apadIdx).toBeLessThan(shortestIdx)
  })

  it('strips audio (-an) when the input has no audio, same as the prior unconditional behavior', () => {
    expect(buildAudioArgs(false)).toEqual({
      mapArgs: [],
      codecArgs: ['-an'],
    })
  })

  it('front-pads audio with adelay when the intro title card shifts the content later', () => {
    expect(buildAudioArgs(true, 2200)).toEqual({
      mapArgs: ['-map', '0:a?'],
      codecArgs: ['-c:a', 'aac', '-af', 'adelay=2200:all=1,apad', '-shortest'],
    })
    // No intro => identical to the delay-less call.
    expect(buildAudioArgs(true, 0)).toEqual(buildAudioArgs(true))
  })
})

describe('buildVoiceoverAudioArgs — voiceover audio-arg branch (no ffmpeg needed)', () => {
  it('maps the voiceover input (not the source 0:a) and pins audio to the video duration via apad+atrim', () => {
    expect(buildVoiceoverAudioArgs(3, 4)).toEqual({
      mapArgs: ['-map', '3:a'],
      codecArgs: ['-c:a', 'aac', '-af', 'apad,atrim=end=4.000000'],
    })
  })

  it('does NOT map the source 0:a — the voiceover fully replaces input audio', () => {
    const { mapArgs } = buildVoiceoverAudioArgs(5, 1.5)
    expect(mapArgs).toEqual(['-map', '5:a'])
    expect(mapArgs).not.toContain('0:a?')
    expect(mapArgs).not.toContain('0:a')
  })

  it('pads (apad) then trims (atrim=end) to the exact video duration — short VO padded, long VO cut', () => {
    const { codecArgs } = buildVoiceoverAudioArgs(2, 0.5)
    const afIdx = codecArgs.indexOf('-af')
    expect(afIdx).toBeGreaterThan(-1)
    expect(codecArgs[afIdx + 1]).toBe('apad,atrim=end=0.500000')
  })

  it('targets the supplied voiceover input index', () => {
    expect(buildVoiceoverAudioArgs(7, 2).mapArgs).toEqual(['-map', '7:a'])
  })

  it('delays the voiceover past the intro title card while still pinning to the video duration', () => {
    expect(buildVoiceoverAudioArgs(3, 4, 2200).codecArgs).toEqual(
      ['-c:a', 'aac', '-af', 'adelay=2200:all=1,apad,atrim=end=4.000000'],
    )
    expect(buildVoiceoverAudioArgs(3, 4, 0)).toEqual(buildVoiceoverAudioArgs(3, 4))
  })
})

describe('buildMixedAudioArgs — layered audio graph (no ffmpeg needed)', () => {
  it('ducks music under SFX and delays each cue by its time plus the intro shift', () => {
    const args = buildMixedAudioArgs({
      music: 'bed.m4a',
      sfx: [
        { atMs: 250, file: 'click.wav' },
        { atMs: 900, file: 'chime.wav' },
      ],
      base: { kind: 'source' },
      nextInputIndex: 4,
      videoDurationSec: 3,
      delayMs: 1800,
    })

    expect(args.inputArgs).toEqual(['-i', 'bed.m4a', '-i', 'click.wav', '-i', 'chime.wav'])
    expect(args.filter).toContain('[5:a]adelay=2050:all=1[asfx0]')
    expect(args.filter).toContain('[6:a]adelay=2700:all=1[asfx1]')
    expect(args.filter).toContain('[asfx0][asfx1]amix=inputs=2:duration=longest:normalize=0[asfxmix]')
    expect(args.filter).toContain('[asfxmix]asplit=2[aduck][asfxout]')
    expect(args.filter).toContain('[4:a][aduck]sidechaincompress=threshold=0.02:ratio=8:attack=5:release=250[abed]')
    expect(args.filter).toContain('[abase][abed][asfxout]amix=inputs=3:duration=longest:normalize=0,apad,atrim=end=3.000000[aout]')
  })

  it('pins a music-only graph to the video duration with apad and atrim', () => {
    const args = buildMixedAudioArgs({
      music: 'bed.m4a',
      sfx: [],
      base: { kind: 'none' },
      nextInputIndex: 3,
      videoDurationSec: 2.25,
    })

    expect(args.inputArgs).toEqual(['-i', 'bed.m4a'])
    expect(args.filter).toBe('[3:a]apad,atrim=end=2.250000[aout]')
  })

  it('uses the supplied voiceover input label for the base track', () => {
    const args = buildMixedAudioArgs({
      sfx: [{ atMs: 300, file: 'click.wav' }],
      base: { kind: 'voiceover', inputIndex: 7 },
      nextInputIndex: 8,
      videoDurationSec: 1.5,
    })

    expect(args.filter).toContain('[7:a]anull[abase]')
    expect(args.filter).not.toContain('[0:a]')
  })

  it('rejects an empty graph with no base, music, or SFX', () => {
    expect(() => buildMixedAudioArgs({
      sfx: [],
      base: { kind: 'none' },
      nextInputIndex: 1,
      videoDurationSec: 1,
    })).toThrow('buildMixedAudioArgs requires at least one of base/music/sfx')
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

describe('polishScript — voiceover track', () => {
  ffmpegIt('muxes a voiceover as an aac stream trimmed to the video duration (long VO), replacing input audio', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input-with-audio.mp4')
    const voiceover = join(root, 'voiceover.m4a')
    const outPath = join(root, 'scripted-voiceover.mp4')
    // Source HAS its own audio so we prove the voiceover REPLACES it.
    await makeTestVideoWithAudio(input, 64, 36, 0.5)
    // Voiceover is LONGER than the video → must be cut to the video duration.
    await makeVoiceover(voiceover, 2.0)

    const result = await polishScript({
      input,
      script: { finalCaption: 'Done', beats: [{ id: 'a', stepLabel: '1', stepText: 'Step', startMs: 0, endMs: 250 }] },
      outPath,
      voiceover,
    })

    expect(result).toMatchObject({ outPath, width: 1920, height: 1080, fps: 60 })
    expect(await probeAudioCodec(outPath)).toBe('aac')
    const videoDur = await probeStreamDurationSec(outPath, 'v:0')
    const audioDur = await probeStreamDurationSec(outPath, 'a:0')
    // Audio ~= video duration (long VO trimmed to video, not the 2.0s VO length).
    expect(Math.abs(audioDur - videoDur)).toBeLessThan(0.2)
    expect(audioDur).toBeLessThan(1.0)
  }, 30_000)

  ffmpegIt('does not truncate the video when the voiceover is shorter than the video (short VO padded)', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input-silent.mp4')
    const voiceover = join(root, 'voiceover-short.m4a')
    const outPath = join(root, 'scripted-voiceover-short.mp4')
    await makeTestVideo(input, 64, 36, 0.5)
    // Voiceover is SHORTER than the video → video must keep its full length.
    await makeVoiceover(voiceover, 0.1)

    const result = await polishScript({
      input,
      script: { finalCaption: 'Done', beats: [{ id: 'a', stepLabel: '1', stepText: 'Step', startMs: 0, endMs: 250 }] },
      outPath,
      voiceover,
    })

    expect(result).toMatchObject({ outPath, fps: 60 })
    expect(await probeHasAudioStream(outPath)).toBe(true)
    expect(await probeAudioCodec(outPath)).toBe('aac')
    const videoDur = await probeStreamDurationSec(outPath, 'v:0')
    // Video stayed ~0.5s (not collapsed to the 0.1s VO length).
    expect(videoDur).toBeGreaterThan(0.35)
  }, 30_000)

  ffmpegIt('leaves audio behavior unchanged when no voiceover is given (input audio passthrough)', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input-with-audio.mp4')
    const outPath = join(root, 'scripted-no-voiceover.mp4')
    await makeTestVideoWithAudio(input, 64, 36, 0.5)

    await polishScript({
      input,
      script: { finalCaption: 'Done', beats: [{ id: 'a', stepLabel: '1', stepText: 'Step', startMs: 0, endMs: 250 }] },
      outPath,
    })

    // Unchanged: source audio is preserved (passthrough), still an aac stream.
    expect(await probeHasAudioStream(outPath)).toBe(true)
    expect(await probeAudioCodec(outPath)).toBe('aac')
  }, 30_000)
})

describe('polishScript — intro title card', () => {
  ffmpegIt('prepends a ~1.8s intro card when script.title is set (renderer available)', async () => {
    const { textRendererAvailability } = await import('../../src/pipeline/text-render.js')
    const available = (await textRendererAvailability()).available
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'scripted-title.mp4')
    await makeTestVideo(input, 64, 36, 0.25)

    const result = await polishScript({
      input,
      script: {
        title: 'Spectra Demo',
        finalCaption: 'Done',
        beats: [
          { id: 'a', stepLabel: '1', stepText: 'Step', startMs: 0, endMs: 250, zoom: { cx: 0.5, cy: 0.5, scale: 1.2 } },
        ],
      },
      outPath,
      fps: 30,
    })

    if (available) {
      // Timeline extended by the intro: ~0.25s source + 1.8s card.
      expect(result.durationMs).toBeGreaterThanOrEqual(2000)
      const videoDur = await probeStreamDurationSec(outPath, 'v:0')
      expect(videoDur).toBeGreaterThan(1.9)
    } else {
      // No native renderer: intro is skipped, unchanged behavior.
      expect(result.durationMs).toBeLessThan(1000)
    }
  }, 60_000)

  ffmpegIt('does not extend the timeline when the script has no title', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'scripted-untitled.mp4')
    await makeTestVideo(input, 64, 36, 0.25)

    const result = await polishScript({
      input,
      script: { finalCaption: 'Done', beats: [{ id: 'a', stepText: 'Step', startMs: 0, endMs: 250 }] },
      outPath,
      fps: 30,
    })

    expect(result.durationMs).toBeLessThan(1000)
    const videoDur = await probeStreamDurationSec(outPath, 'v:0')
    expect(videoDur).toBeLessThan(1.0)
  }, 30_000)
})

describe('finalCaptionWindow (short-input robustness)', () => {
  const script = {
    title: 'T', finalCaption: 'The end',
    beats: [
      { id: 'a', stepText: 'step one', startMs: 0, endMs: 5000 },
      { id: 'end', stepText: 'The end', startMs: 42000, endMs: 50000 },
    ],
  } as unknown as Parameters<typeof finalCaptionWindow>[0]

  it('places the caption on its matching beat when in range', () => {
    expect(finalCaptionWindow(script, 'The end', 50000)).toEqual({ startMs: 42000, endMs: 50000 })
  })

  it('returns null when the placing beat is truncated out of a short input (no full-clip overlap)', () => {
    expect(finalCaptionWindow(script, 'The end', 15000)).toBeNull()
  })

  it('shows full-clip for a caption-only script with no beats', () => {
    const capOnly = { title: 'T', finalCaption: 'Only', beats: [] } as unknown as Parameters<typeof finalCaptionWindow>[0]
    expect(finalCaptionWindow(capOnly, 'Only', 8000)).toEqual({ startMs: 0, endMs: 8000 })
  })
})
