import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildZoomTrack } from '../../src/pipeline/zoom-keyframes.js'
import { zoomFilter } from '../../src/pipeline/zoom-render.js'
import { ffmpegAvailable, probeVideo, runProcess } from './ffmpeg-helpers.js'

let workDir: string | null = null
const ffmpegIt = ffmpegAvailable ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-zoom-render-'))
  return workDir
}

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('zoomFilter', () => {
  it('returns a zoompan filter with on-indexed expressions', () => {
    const track = buildZoomTrack([{ tMs: 80, cx: 0.7, cy: 0.4 }], 1500, 60, { scale: 1.25 })
    const filter = zoomFilter(track, 64, 36, 128, 72)

    expect(filter).toContain('zoompan=')
    expect(filter).toContain("z='")
    expect(filter).toContain('lte(on\\,')
    expect(filter).toContain('s=128x72')
  })

  it('uses the requested output fps', () => {
    const track = buildZoomTrack([{ tMs: 80, cx: 0.7, cy: 0.4 }], 1500, 30, { scale: 1.25 })
    const filter = zoomFilter(track, 64, 36, 128, 72, 30)

    expect(filter).toContain('fps=30')
  })

  ffmpegIt('renders frames through zoompan and preserves requested dimensions', async () => {
    const root = await makeWorkDir()
    const outPath = join(root, 'zoom.mp4')
    const track = buildZoomTrack([{ tMs: 80, cx: 0.7, cy: 0.4 }], 1500, 60, { scale: 1.25 })

    await runProcess('ffmpeg', [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc2=size=64x36:rate=60:duration=0.25',
      '-vf', zoomFilter(track, 64, 36, 128, 72),
      '-frames:v', '6',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-y',
      outPath,
    ])

    await expect(probeVideo(outPath)).resolves.toMatchObject({
      width: 128,
      height: 72,
    })
  })
})
