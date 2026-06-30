import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cardsFromScript, normalizeStepLabel, timedStepCardsFilter, timedStepCardsOverlayPlan } from '../../src/pipeline/annotations.js'
import type { DemoScript } from '../../src/pipeline/script.js'
import { setTextRendererAvailabilityForTests, textRendererAvailability } from '../../src/pipeline/text-render.js'

let workDir: string | null = null
const pilAvailability = await textRendererAvailability()
const pilIt = pilAvailability.available ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-annotations-'))
  return workDir
}

afterEach(async () => {
  setTextRendererAvailabilityForTests(undefined)
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

const script: DemoScript = {
  beats: [
    {
      id: 'search',
      stepLabel: '①',
      stepText: 'Search everything',
      startMs: 0,
      endMs: 1200,
      action: { kind: 'search', value: 'agents' },
    },
    {
      id: 'graph',
      stepLabel: '②',
      stepText: 'Connect the graph',
      startMs: 1200,
      endMs: 2400,
      action: { kind: 'navigate', target: 'Graph' },
    },
    {
      id: 'empty',
      stepText: '  ',
      startMs: 2400,
      endMs: 3000,
      action: { kind: 'hold' },
    },
  ],
}

describe('timed step cards', () => {
  it('derives step cards from script beats with visible text', () => {
    expect(cardsFromScript(script)).toEqual([
      {
        stepLabel: '①',
        stepText: 'Search everything',
        startMs: 0,
        endMs: 1200,
      },
      {
        stepLabel: '②',
        stepText: 'Connect the graph',
        startMs: 1200,
        endMs: 2400,
      },
    ])
  })

  it('normalizes circled step labels for the bitmap font', () => {
    expect(normalizeStepLabel('①')).toBe('1')
    expect(normalizeStepLabel(' Step 2 ')).toBe('STEP2')
    expect(normalizeStepLabel('')).toBeUndefined()
  })

  it('builds an ffmpeg card overlay graph', () => {
    const filter = timedStepCardsFilter({
      cards: cardsFromScript(script),
      inputLabel: 'framed',
      outputLabel: 'v',
      outW: 320,
      outH: 180,
      fps: 30,
      fontPixel: 4,
      fadeMs: 100,
    })

    expect(filter).toContain('[framed]')
    expect(filter.match(/enable='between/g)).toHaveLength(2)
    expect(filter).toContain("enable='between(t\\,0\\,1.2)'")
    expect(filter).toContain("enable='between(t\\,1.2\\,2.4)'")
    expect(filter).toContain('fade=t=in:st=0:d=0.1')
    expect(filter).toContain('fade=t=out:st=1.1:d=0.1')
    expect(filter).toContain('fade=t=in:st=1.2:d=0.1')
    expect(filter).toContain('[v]')
  })

  pilIt('uses rendered PNG overlays when Pillow is available', async () => {
    const cacheDir = await makeWorkDir()
    const plan = await timedStepCardsOverlayPlan({
      cards: cardsFromScript(script),
      inputLabel: 'framed',
      outputLabel: 'v',
      inputIndexStart: 1,
      outW: 320,
      outH: 180,
      fps: 30,
      fadeMs: 100,
      cacheDir,
    })

    expect(plan.usedPng).toBe(true)
    expect(plan.imagePaths).toHaveLength(2)
    expect(plan.nextInputIndex).toBe(3)
    expect(plan.filter).toContain('[1:v]format=rgba')
    expect(plan.filter).toContain('[2:v]format=rgba')
    expect(plan.filter).not.toContain('drawbox=')
    expect(plan.filter.match(/enable='between/g)).toHaveLength(2)
    expect(plan.filter).toContain("enable='between(t\\,0\\,1.2)'")
    expect(plan.filter).toContain("enable='between(t\\,1.2\\,2.4)'")
    expect(plan.filter).toContain('fade=t=in:st=0:d=0.1')
    expect(plan.filter).toContain('fade=t=out:st=1.1:d=0.1')
  })

  it('falls back to the bitmap card graph when Pillow is unavailable', async () => {
    setTextRendererAvailabilityForTests({ available: false, reason: 'test override' })
    const plan = await timedStepCardsOverlayPlan({
      cards: cardsFromScript(script),
      inputLabel: 'framed',
      outputLabel: 'v',
      inputIndexStart: 1,
      outW: 320,
      outH: 180,
      fps: 30,
      fontPixel: 4,
      fadeMs: 100,
    })

    expect(plan.usedPng).toBe(false)
    expect(plan.imagePaths).toEqual([])
    expect(plan.nextInputIndex).toBe(1)
    expect(plan.filter).toContain('drawbox=')
    expect(plan.filter.match(/enable='between/g)).toHaveLength(2)
    expect(plan.filter).toContain("enable='between(t\\,0\\,1.2)'")
    expect(plan.filter).toContain("enable='between(t\\,1.2\\,2.4)'")
    expect(plan.filter).toContain('[v]')
  })
})
