import { describe, expect, it } from 'vitest'
import { cardsFromScript, normalizeStepLabel, timedStepCardsFilter } from '../../src/pipeline/annotations.js'
import type { DemoScript } from '../../src/pipeline/script.js'

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
})
