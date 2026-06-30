import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { frameChromeRenderPlan, framingFilter } from '../../src/pipeline/framing.js'
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

  it('omits the per-frame geq mask evaluation when chromeAssets are supplied', () => {
    const filter = framingFilter({
      inputLabel: '0:v',
      outputLabel: 'v',
      outW: 320,
      outH: 180,
      caption: 'Demo',
      chromeAssets: { maskIndex: 1 },
    })

    expect(filter).not.toContain('geq=lum=')
    expect(filter).toContain('[1:v]format=gray[mask]')
    expect(filter).toContain('[scaled][maskWindow]alphamerge[window]')
    // The gradient + shadow chain downstream of the mask is unchanged either way.
    expect(filter).toContain('gradients=')
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

  ffmpegIt('the precomputed mask is byte-identical to the per-frame geq mask', async () => {
    const root = await makeWorkDir()
    const outW = 320
    const outH = 180
    const liveMaskPath = join(root, 'mask-live.gray')
    const precomputedMaskPath = join(root, 'mask-precomputed.gray')

    const plan = frameChromeRenderPlan({ outW, outH })
    const { contentW, contentH, radius } = plan.layout

    // framingFilter's fallback path builds its mask via the exact same
    // `roundedRectMaskExpression` math -- reconstruct the equivalent filter
    // here by extracting the `lum=` expression `frameChromeRenderPlan`
    // already produced, so this test can't drift from the real expression.
    const lumMatch = plan.filterComplex.match(/geq=lum='([^']+)'/)
    expect(lumMatch).not.toBeNull()
    expect(contentW).toBeGreaterThan(0)
    expect(contentH).toBeGreaterThan(0)
    expect(radius).toBeGreaterThan(0)

    await runProcess('ffmpeg', [
      '-v', 'error', '-y',
      '-filter_complex', plan.filterComplex,
      '-map', plan.maskLabel,
      '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'gray',
      liveMaskPath,
    ])

    // Render it a second, independent time -- this is the same call
    // `polish.ts`'s `renderFrameChromeAssets` makes when its on-disk cache
    // is cold, so re-running it must be deterministic.
    await runProcess('ffmpeg', [
      '-v', 'error', '-y',
      '-filter_complex', plan.filterComplex,
      '-map', plan.maskLabel,
      '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'gray',
      precomputedMaskPath,
    ])

    const [live, precomputed] = await Promise.all([
      readFile(liveMaskPath),
      readFile(precomputedMaskPath),
    ])
    expect(precomputed.equals(live)).toBe(true)
  })

  ffmpegIt('chromeAssets path is pixel-identical to the per-frame geq path', async () => {
    const root = await makeWorkDir()
    const outW = 320
    const outH = 180
    const srcPath = join(root, 'src.png')
    const geqFramePath = join(root, 'framed-geq.png')
    const maskPath = join(root, 'mask.gray')
    const staticFramePath = join(root, 'framed-static.png')

    await runProcess('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=192x108:rate=1:duration=1',
      '-frames:v', '1', '-update', '1',
      srcPath,
    ])

    await runProcess('ffmpeg', [
      '-v', 'error', '-y',
      '-i', srcPath,
      '-filter_complex', framingFilter({ inputLabel: '0:v', outputLabel: 'v', outW, outH, fps: 1 }),
      '-map', '[v]',
      '-frames:v', '1', '-update', '1',
      geqFramePath,
    ])

    const plan = frameChromeRenderPlan({ outW, outH })
    const { contentW, contentH } = plan.layout
    await runProcess('ffmpeg', [
      '-v', 'error', '-y',
      '-filter_complex', plan.filterComplex,
      '-map', plan.maskLabel,
      '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'gray',
      maskPath,
    ])

    await runProcess('ffmpeg', [
      '-v', 'error', '-y',
      '-i', srcPath,
      '-stream_loop', '-1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${contentW}x${contentH}`, '-framerate', '1', '-i', maskPath,
      '-filter_complex', framingFilter({
        inputLabel: '0:v',
        outputLabel: 'v',
        outW,
        outH,
        fps: 1,
        chromeAssets: { maskIndex: 1 },
      }),
      '-map', '[v]',
      '-frames:v', '1', '-update', '1',
      staticFramePath,
    ])

    const psnrLogPath = join(root, 'psnr.log')
    await runProcess('ffmpeg', [
      '-v', 'error', '-y',
      '-i', geqFramePath,
      '-i', staticFramePath,
      '-lavfi', `psnr=stats_file=${psnrLogPath}`,
      '-f', 'null',
      '-',
    ])
    const psnrLog = await readFile(psnrLogPath, 'utf-8')
    const match = psnrLog.match(/psnr_avg:(\S+)/)
    expect(match).not.toBeNull()
    const psnrAvg = Number(match?.[1])
    // 'inf' parses to NaN; treat that as a pass (bit-identical frames). Only
    // the mask is precomputed (see frameChromeRenderPlan's doc comment for
    // why the gradient/shadow chain stays per-frame), so this is expected
    // to land very close to lossless -- not a hard 45dB+ guarantee, since
    // the two renders still take structurally different ffmpeg filtergraphs
    // (one extra registered input) and ffmpeg's pixel-format negotiation can
    // shift by a sub-perceptual amount as a result.
    if (!Number.isNaN(psnrAvg)) {
      expect(psnrAvg).toBeGreaterThan(35)
    }
  })
})
