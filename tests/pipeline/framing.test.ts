import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { framingFilter } from '../../src/pipeline/framing.js'
import { ffmpegAvailable, probeVideo, runProcess } from './ffmpeg-helpers.js'

let workDir: string | null = null
const ffmpegIt = ffmpegAvailable ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-framing-'))
  return workDir
}

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('framingFilter', () => {
  it('returns an ffmpeg-only composition graph', () => {
    const filter = framingFilter({ inputLabel: '0:v', outputLabel: 'v', outW: 320, outH: 180, caption: 'Demo' })

    expect(filter).toContain('gradients=')
    expect(filter).toContain('geq=lum=')
    expect(filter).toContain('alphamerge')
    expect(filter).toContain('gblur=')
    expect(filter).toContain('drawtext=')
  })

  ffmpegIt('renders a framed clip at the requested dimensions', async () => {
    const root = await makeWorkDir()
    const outPath = join(root, 'framed.mp4')

    await runProcess('ffmpeg', [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc2=size=192x108:rate=60:duration=0.25',
      '-filter_complex', framingFilter({
        inputLabel: '0:v',
        outputLabel: 'v',
        outW: 320,
        outH: 180,
        cornerRadius: 8,
        fontSize: 16,
        caption: 'Demo caption',
        captionMode: 'bitmap',
      }),
      '-map', '[v]',
      '-frames:v', '6',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-y',
      outPath,
    ])

    await expect(probeVideo(outPath)).resolves.toMatchObject({
      width: 320,
      height: 180,
    })
  })
})
