import { access, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  renderCaptionPng,
  renderStepCardPng,
  setTextRendererAvailabilityForTests,
  textRendererAvailability,
} from '../../src/pipeline/text-render.js'

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
})
