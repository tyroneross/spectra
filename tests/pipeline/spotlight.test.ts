import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDarkSpotlightFilter,
  cleanupSpotlightPrePass,
  DARK_SPOTLIGHT_DEFAULTS,
  renderSpotlightPrePass,
} from '../../src/pipeline/spotlight.js'
import { ffmpegAvailable, makeTestVideo, runProcess } from './ffmpeg-helpers.js'

let workDir: string | null = null
const ffmpegIt = ffmpegAvailable ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-spotlight-'))
  return workDir
}

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

/** Mean luma (YAVG) over a crop region, via ffmpeg's signalstats filter. */
async function meanLuma(path: string, crop: { x: number; y: number; w: number; h: number }): Promise<number> {
  const output = await runProcess('ffmpeg', [
    '-nostats',
    '-i', path,
    '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},signalstats,metadata=print:file=-`,
    '-an',
    '-f', 'null',
    '-',
  ])
  const match = output.match(/lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/)
  if (!match) throw new Error(`No YAVG metadata found for ${path}`)
  return Number.parseFloat(match[1])
}

describe('buildDarkSpotlightFilter', () => {
  it('applies DARK_SPOTLIGHT_DEFAULTS when no overrides are given', () => {
    const filter = buildDarkSpotlightFilter({
      focal: { x: 10, y: 20, w: 100, h: 80 },
      canvas: { w: 640, h: 360 },
    })
    expect(filter).toContain(`gblur=sigma=${DARK_SPOTLIGHT_DEFAULTS.blur}`)
    expect(filter).toContain(`brightness=-${DARK_SPOTLIGHT_DEFAULTS.dim}`)
    expect(filter).toContain(`gblur=sigma=${DARK_SPOTLIGHT_DEFAULTS.feather}`)
    expect(DARK_SPOTLIGHT_DEFAULTS).toMatchObject({ dim: 0.75, blur: 8, feather: 26 })
  })

  it('respects explicit dim/blur/feather overrides', () => {
    const filter = buildDarkSpotlightFilter({
      focal: { x: 0, y: 0, w: 50, h: 50 },
      canvas: { w: 200, h: 100 },
      dim: 0.5,
      blur: 4,
      feather: 12,
    })
    expect(filter).toContain('gblur=sigma=4')
    expect(filter).toContain('brightness=-0.5')
    expect(filter).toContain('gblur=sigma=12')
  })

  it('keeps the focal rect coordinates in the drawbox stage', () => {
    const filter = buildDarkSpotlightFilter({
      focal: { x: 33, y: 44, w: 55, h: 66 },
      canvas: { w: 640, h: 360 },
    })
    expect(filter).toContain('drawbox=33:44:55:66:white:fill')
  })
})

describe('renderSpotlightPrePass', () => {
  ffmpegIt('keeps the focal rect near-original brightness and crushes the periphery toward black', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    await makeTestVideo(input, 480, 270, 0.2)

    const focal = { x: 120, y: 67, w: 240, h: 135 } // middle 50% of 480x270
    const focalSample = { x: 180, y: 109, w: 120, h: 60 } // well inside the focal rect
    const peripherySample = { x: 0, y: 0, w: 40, h: 30 } // top-left corner, outside focal+feather

    const outPath = await renderSpotlightPrePass({
      input,
      canvas: { w: 480, h: 270 },
      focal,
      hasAudio: false,
    })

    try {
      const focalLumaOrig = await meanLuma(input, focalSample)
      const focalLumaSpot = await meanLuma(outPath, focalSample)
      const peripheryLumaOrig = await meanLuma(input, peripherySample)
      const peripheryLumaSpot = await meanLuma(outPath, peripherySample)

      // Focal pane stays close to its original brightness — it's the sharp,
      // unmodified source passed through the alpha mask.
      expect(Math.abs(focalLumaSpot - focalLumaOrig)).toBeLessThan(20)

      // Periphery is crushed dramatically darker than the original frame —
      // this is the numeric proof the dark-crush actually happened.
      expect(peripheryLumaSpot).toBeLessThan(peripheryLumaOrig - 30)
      expect(peripheryLumaSpot).toBeLessThan(15) // near-black
    } finally {
      await cleanupSpotlightPrePass(outPath)
    }
  }, 30_000)

  ffmpegIt('stream-copies audio through when the source has an audio track', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input-audio.mp4')
    await runProcess('ffmpeg', [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc2=size=160x90:rate=60:duration=0.2',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=0.2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-y',
      input,
    ])

    const outPath = await renderSpotlightPrePass({
      input,
      canvas: { w: 160, h: 90 },
      focal: { x: 40, y: 22, w: 80, h: 45 },
      hasAudio: true,
    })

    try {
      const probe = await runProcess('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=index',
        '-of', 'csv=p=0',
        outPath,
      ])
      expect(probe.trim().length).toBeGreaterThan(0)
    } finally {
      await cleanupSpotlightPrePass(outPath)
    }
  }, 30_000)
})
