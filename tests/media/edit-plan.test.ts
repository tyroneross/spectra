import { describe, expect, it } from 'vitest'
import { compileEditPlan, narrationCacheKey, parseEditPlan, type EditPlanInput } from '../../src/media/edit-plan.js'

function easyTerminalPlan(): EditPlanInput {
  return {
    schemaVersion: 1,
    id: 'easy-terminal-proof-led',
    title: 'Easy Terminal',
    fps: 30,
    canvas: { width: 1920, height: 1080 },
    claims: [
      { id: 'sessions-visible', text: 'Keep coding sessions in view.', status: 'supported' },
      { id: 'automatic-coordination', text: 'Agents coordinate automatically.', status: 'blocked' },
    ],
    beats: [
      {
        id: 'hook',
        startMs: 0,
        endMs: 12_000,
        keyMessage: 'One place to see every coding session',
        claimIds: ['sessions-visible'],
        caption: 'One place to see every coding session.',
        narration: { text: 'One place to see every coding session.', durationMs: 3_200, voice: 'Ava', rate: 1 },
      },
      {
        id: 'proof',
        startMs: 12_000,
        endMs: 65_000,
        keyMessage: 'Follow work without switching windows',
        claimIds: ['sessions-visible'],
        narration: { text: 'Follow the work without switching windows.', durationMs: 3_500, voice: 'Ava', rate: 1 },
      },
      {
        id: 'cta',
        startMs: 65_000,
        endMs: 73_000,
        keyMessage: 'Follow the early alpha at RossLabs.ai',
        caption: 'Follow the early alpha at RossLabs.ai.',
      },
    ],
  }
}

describe('edit plan compiler', () => {
  it('generates one 73-second manifest, narration list, and SRT from the canonical plan', () => {
    const compiled = compileEditPlan(easyTerminalPlan())

    expect(compiled.durationMs).toBe(73_000)
    expect(compiled.manifest.durationMs).toBe(73_000)
    expect(compiled.manifest.beats.map((beat) => [beat.id, beat.startMs, beat.endMs])).toEqual([
      ['hook', 0, 12_000],
      ['proof', 12_000, 65_000],
      ['cta', 65_000, 73_000],
    ])
    expect(compiled.narration).toHaveLength(2)
    expect(compiled.narration[0].cacheKey).toHaveLength(64)
    expect(compiled.captionsSrt).toContain('00:01:05,000 --> 00:01:13,000')
    expect(compiled.captionsSrt).toContain('Follow the early alpha at RossLabs.ai.')
  })

  it('rejects unknown and blocked claim references', () => {
    const unknown = easyTerminalPlan()
    unknown.beats[0].claimIds = ['not-in-ledger']
    expect(() => parseEditPlan(unknown)).toThrow(/Unknown claim id/)

    const blocked = easyTerminalPlan()
    blocked.beats[0].claimIds = ['automatic-coordination']
    expect(() => parseEditPlan(blocked)).toThrow(/Blocked claim cannot be used/)
  })

  it('rejects narration that is longer than its beat', () => {
    const plan = easyTerminalPlan()
    plan.beats[0].narration!.durationMs = 12_001
    expect(() => parseEditPlan(plan)).toThrow(/Narration exceeds beat duration by 1ms/)
  })

  it('rejects overlapping beats', () => {
    const plan = easyTerminalPlan()
    plan.beats[1].startMs = 11_999
    expect(() => parseEditPlan(plan)).toThrow(/overlaps the previous beat/)
  })

  it('keys narration audio by text, voice, rate, and engine', () => {
    const base = { text: 'Keep every session in view.', voice: 'Ava', rate: 1, engine: 'system' }
    const key = narrationCacheKey(base)

    expect(narrationCacheKey(base)).toBe(key)
    expect(narrationCacheKey({ ...base, text: 'Keep each session in view.' })).not.toBe(key)
    expect(narrationCacheKey({ ...base, voice: 'Samantha' })).not.toBe(key)
    expect(narrationCacheKey({ ...base, rate: 1.05 })).not.toBe(key)
    expect(narrationCacheKey({ ...base, engine: 'elevenlabs' })).not.toBe(key)
  })
})
