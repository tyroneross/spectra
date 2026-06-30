import { spawnSync } from 'node:child_process'
import { access, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CAPTION_BANNER_SPEC,
  renderCaptionPng,
  renderStepCardPng,
  setTextRendererAvailabilityForTests,
  textRendererAvailability,
} from '../../src/pipeline/text-render.js'

function samplePixel(pngPath: string, x: number, y: number): [number, number, number, number] {
  const result = spawnSync('python3', ['-c', `
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGBA')
print(*img.getpixel((int(sys.argv[2]), int(sys.argv[3]))))
`, pngPath, String(x), String(y)])
  if (result.status !== 0) {
    throw new Error(`pixel sample failed: ${result.stderr.toString()}`)
  }
  const [r, g, b, a] = result.stdout.toString().trim().split(' ').map(Number)
  return [r, g, b, a]
}

let workDir: string | null = null
const pilAvailability = await textRendererAvailability()
const pilIt = pilAvailability.available ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-text-render-'))
  return workDir
}

afterEach(async () => {
  setTextRendererAvailabilityForTests(undefined)
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('Pillow text renderer', () => {
  pilIt('renders and caches step-card and caption PNGs', async () => {
    const cacheDir = await makeWorkDir()
    const firstCard = await renderStepCardPng({
      stepLabel: '1',
      stepText: 'Search the entire AI landscape',
      outW: 320,
      outH: 180,
      x: 20,
      y: 12,
      cacheDir,
    })
    const secondCard = await renderStepCardPng({
      stepLabel: '1',
      stepText: 'Search the entire AI landscape',
      outW: 320,
      outH: 180,
      x: 20,
      y: 12,
      cacheDir,
    })
    const caption = await renderCaptionPng({
      text: 'Atomize AI - distilled daily',
      outW: 320,
      outH: 180,
      cacheDir,
    })

    expect(firstCard).toBeTruthy()
    expect(secondCard).toBe(firstCard)
    expect(caption).toBeTruthy()
    await expect(access(firstCard ?? '')).resolves.toBeUndefined()
    await expect(access(caption ?? '')).resolves.toBeUndefined()
    expect((await stat(firstCard ?? '')).size).toBeGreaterThan(100)
    expect((await stat(caption ?? '')).size).toBeGreaterThan(100)
    expect(firstCard).toContain('step-card-')
    expect(caption).toContain('caption-')
  })

  it('returns undefined instead of throwing when Pillow is unavailable', async () => {
    setTextRendererAvailabilityForTests({ available: false, reason: 'test override' })

    await expect(renderStepCardPng({ stepText: 'Search everything' })).resolves.toBeUndefined()
    await expect(renderCaptionPng({ text: 'Done' })).resolves.toBeUndefined()
  })

  it('matches the canonical caption banner spec (colors + geometry ratios)', () => {
    expect(CAPTION_BANNER_SPEC.bannerHeightRatio).toBe(0.12)
    expect(CAPTION_BANNER_SPEC.bannerBackground).toEqual({ r: 5, g: 7, b: 9 })
    expect(CAPTION_BANNER_SPEC.bannerBackgroundAlpha).toBe(0.92)
    expect(CAPTION_BANNER_SPEC.chipSideRatio).toBe(0.06)
    expect(CAPTION_BANNER_SPEC.chipCornerRadiusRatio).toBe(0.2)
    expect(CAPTION_BANNER_SPEC.chipColor).toEqual({ r: 39, g: 175, b: 232 })
    expect(CAPTION_BANNER_SPEC.chipInsetXRatio).toBe(0.0325)
    expect(CAPTION_BANNER_SPEC.captionTextColor).toEqual({ r: 248, g: 250, b: 252 })
    expect(CAPTION_BANNER_SPEC.captionGapRatio).toBe(0.015)
  })

  pilIt('renders a step-card banner whose pixels match the banner/chip/text spec colors', async () => {
    const cacheDir = await makeWorkDir()
    const outW = 1920
    const outH = 1080
    const path = await renderStepCardPng({
      stepLabel: '1',
      stepText: 'Search the entire AI landscape',
      outW,
      outH,
      fontSize: 40,
      cacheDir,
    })
    expect(path).toBeTruthy()
    if (!path) return

    const bannerH = Math.round(outH * CAPTION_BANNER_SPEC.bannerHeightRatio)
    const bannerY = outH - bannerH

    // Banner background, sampled away from the chip and text (top-right of the band).
    const bannerPixel = samplePixel(path, outW - 10, bannerY + 10)
    expect(bannerPixel[0]).toBeCloseTo(CAPTION_BANNER_SPEC.bannerBackground.r, 0)
    expect(bannerPixel[1]).toBeCloseTo(CAPTION_BANNER_SPEC.bannerBackground.g, 0)
    expect(bannerPixel[2]).toBeCloseTo(CAPTION_BANNER_SPEC.bannerBackground.b, 0)

    // Chip fill, sampled off-center (quarter point) to avoid the white number glyph.
    const chipSide = Math.round(outH * CAPTION_BANNER_SPEC.chipSideRatio)
    const chipInsetX = Math.round(outW * CAPTION_BANNER_SPEC.chipInsetXRatio)
    const chipY = bannerY + (bannerH - chipSide) / 2
    const chipFill = samplePixel(path, Math.round(chipInsetX + chipSide * 0.25), Math.round(chipY + chipSide * 0.25))
    expect(chipFill[0]).toBeCloseTo(CAPTION_BANNER_SPEC.chipColor.r, 0)
    expect(chipFill[1]).toBeCloseTo(CAPTION_BANNER_SPEC.chipColor.g, 0)
    expect(chipFill[2]).toBeCloseTo(CAPTION_BANNER_SPEC.chipColor.b, 0)
  })
})
