// tests/media/spotlight.test.ts
import { describe, it, expect } from 'vitest'
import {
  parsePtsLines,
  bucketPerMinute,
  deriveActiveRanges,
  buildSpotlightFilter,
  deriveRampSegments,
} from '../../src/media/spotlight.js'

// ─── parsePtsLines ────────────────────────────────────────────

describe('parsePtsLines', () => {
  it('extracts pts_time values from showinfo output', () => {
    const lines = [
      '[Parsed_showinfo_2 @ 0x7f8] n:   0 pts:      0 pts_time:0.000000 pos:100',
      '[Parsed_showinfo_2 @ 0x7f8] n:   1 pts:   1001 pts_time:33.366667 pos:200',
      'some other ffmpeg line without pts_time',
      '[Parsed_showinfo_2 @ 0x7f8] n:   2 pts:   2002 pts_time:66.733333 pos:300',
    ]
    expect(parsePtsLines(lines)).toEqual([0, 33.366667, 66.733333])
  })

  it('returns empty array when no lines match', () => {
    expect(parsePtsLines(['no pts here', 'nothing useful'])).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(parsePtsLines([])).toEqual([])
  })

  it('handles integer pts_time values (no decimal)', () => {
    const lines = ['[showinfo] pts_time:10 something']
    expect(parsePtsLines(lines)).toEqual([10])
  })

  it('skips non-finite parsed values gracefully', () => {
    const lines = ['pts_time:NaN', 'pts_time:123.45']
    expect(parsePtsLines(lines)).toEqual([123.45])
  })
})

// ─── bucketPerMinute ──────────────────────────────────────────

describe('bucketPerMinute', () => {
  it('groups timestamps into minute buckets sorted by minute', () => {
    const times = [5, 10, 65, 70, 125]
    expect(bucketPerMinute(times)).toEqual([
      { minute: 0, changes: 2 },
      { minute: 1, changes: 2 },
      { minute: 2, changes: 1 },
    ])
  })

  it('returns empty array for empty input', () => {
    expect(bucketPerMinute([])).toEqual([])
  })

  it('handles a single timestamp', () => {
    expect(bucketPerMinute([45])).toEqual([{ minute: 0, changes: 1 }])
  })

  it('handles timestamps spanning many minutes', () => {
    const times = [0, 60, 120, 180]
    expect(bucketPerMinute(times)).toEqual([
      { minute: 0, changes: 1 },
      { minute: 1, changes: 1 },
      { minute: 2, changes: 1 },
      { minute: 3, changes: 1 },
    ])
  })
})

// ─── deriveActiveRanges ───────────────────────────────────────

describe('deriveActiveRanges', () => {
  it('returns empty array for empty input', () => {
    expect(deriveActiveRanges([])).toEqual([])
  })

  it('returns a single range for a single timestamp', () => {
    expect(deriveActiveRanges([42])).toEqual([{ startSec: 42, endSec: 42 }])
  })

  it('merges timestamps within gap tolerance into one range', () => {
    const times = [10, 11, 12, 20, 100, 105]
    // 10-20 are within 15s gap; 100-105 form a second range
    const ranges = deriveActiveRanges(times, 15)
    expect(ranges).toEqual([
      { startSec: 10, endSec: 20 },
      { startSec: 100, endSec: 105 },
    ])
  })

  it('splits at gaps larger than tolerance', () => {
    const times = [0, 1, 10, 100]
    const ranges = deriveActiveRanges(times, 5)
    expect(ranges).toEqual([
      { startSec: 0, endSec: 1 },
      { startSec: 10, endSec: 10 },
      { startSec: 100, endSec: 100 },
    ])
  })

  it('uses default gap tolerance of 5 seconds', () => {
    // gap of 4s (within 5s default) merges; gap of 6s (outside) splits
    const times = [0, 4, 10]
    const ranges = deriveActiveRanges(times)
    expect(ranges).toEqual([
      { startSec: 0, endSec: 4 },
      { startSec: 10, endSec: 10 },
    ])
  })

  it('handles unsorted input — sorts before processing', () => {
    const times = [20, 5, 10]
    const ranges = deriveActiveRanges(times, 15)
    expect(ranges).toEqual([{ startSec: 5, endSec: 20 }])
  })
})

// ─── buildSpotlightFilter ─────────────────────────────────────

describe('buildSpotlightFilter', () => {
  it('contains key filter components for a known focal/canvas combo', () => {
    const filter = buildSpotlightFilter({
      focal: { x: 100, y: 50, w: 400, h: 300 },
      canvas: { w: 1280, h: 720 },
    })
    expect(filter).toContain('gblur')
    expect(filter).toContain('eq=brightness=')
    expect(filter).toContain('alphamerge')
    expect(filter).toContain('overlay')
    expect(filter).toContain('scale=1280:720')
    expect(filter).toContain('pad=1280:720')
    expect(filter).toContain('drawbox=100:50:400:300:white:fill')
  })

  it('starts with split=3 and ends with [out]', () => {
    const filter = buildSpotlightFilter({
      focal: { x: 0, y: 0, w: 100, h: 100 },
      canvas: { w: 640, h: 480 },
    })
    expect(filter).toContain('split=3')
    expect(filter.trimEnd()).toMatch(/\[out\]$/)
  })

  it('covers full frame with the black drawbox mask', () => {
    const filter = buildSpotlightFilter({
      focal: { x: 10, y: 20, w: 200, h: 100 },
      canvas: { w: 1920, h: 1080 },
    })
    expect(filter).toContain('drawbox=0:0:iw:ih:black:fill')
  })

  it('applies custom dim, blur, and feather values', () => {
    const filter = buildSpotlightFilter({
      focal: { x: 0, y: 0, w: 100, h: 100 },
      canvas: { w: 640, h: 480 },
      dim: 0.3,
      blur: 15,
      feather: 20,
    })
    expect(filter).toContain('sigma=15')
    expect(filter).toContain('brightness=-0.3')
    expect(filter).toContain('sigma=20')
  })

  it('uses default dim=0.2, blur=22, feather=40 when omitted', () => {
    const filter = buildSpotlightFilter({
      focal: { x: 0, y: 0, w: 100, h: 100 },
      canvas: { w: 640, h: 480 },
    })
    expect(filter).toContain('sigma=22')
    expect(filter).toContain('brightness=-0.2')
    expect(filter).toContain('sigma=40')
    expect(filter).toContain('saturation=0.6')
  })

  it('includes force_original_aspect_ratio=decrease and setsar=1', () => {
    const filter = buildSpotlightFilter({
      focal: { x: 0, y: 0, w: 100, h: 100 },
      canvas: { w: 1280, h: 720 },
    })
    expect(filter).toContain('force_original_aspect_ratio=decrease')
    expect(filter).toContain('setsar=1')
  })
})

// ─── deriveRampSegments (P3a auto dead-air ramp) ──────────────

describe('deriveRampSegments', () => {
  it('keeps active spans at 1x and speeds long dead-air gaps', () => {
    // active 10–20s in a 40s clip → gaps [0,10) and (20,40] are dead air.
    const segs = deriveRampSegments([{ startSec: 10, endSec: 20 }], 40, { padSec: 0 })
    expect(segs.map(s => s.speed)).toEqual([1.8, 1, 1.8])
    const total = segs.reduce((a, s) => a + s.durationSec, 0)
    expect(total).toBeCloseTo(40, 5)
    expect(segs[1]).toMatchObject({ startSec: 10, durationSec: 10, speed: 1 })
  })

  it('does NOT ramp gaps shorter than minDeadSec', () => {
    // 1s gap before the active range, below the 1.5s floor → stays 1x.
    const segs = deriveRampSegments([{ startSec: 1, endSec: 5 }], 6, { padSec: 0, minDeadSec: 1.5 })
    // [0,1) short gap (1x) coalesces with [1,5) active (1x); (5,6] short gap (1x) coalesces too.
    expect(segs).toHaveLength(1)
    expect(segs[0].speed).toBe(1)
    expect(segs[0].durationSec).toBeCloseTo(6, 5)
  })

  it('pads and merges overlapping active ranges', () => {
    const segs = deriveRampSegments(
      [{ startSec: 5, endSec: 8 }, { startSec: 8.2, endSec: 12 }],
      20,
      { padSec: 0.4 },
    )
    const active = segs.filter(s => s.speed === 1)
    expect(active).toHaveLength(1) // merged into one active span
    expect(active[0].startSec).toBeCloseTo(4.6, 5)
    expect(active[0].durationSec).toBeCloseTo(7.8, 5) // 4.6 → 12.4
  })

  it('returns empty for non-positive duration', () => {
    expect(deriveRampSegments([{ startSec: 0, endSec: 5 }], 0)).toEqual([])
  })

  it('covers the whole timeline gap-free', () => {
    const segs = deriveRampSegments([{ startSec: 3, endSec: 4 }, { startSec: 30, endSec: 35 }], 60, { padSec: 0.2 })
    let cursor = 0
    for (const s of segs) {
      expect(s.startSec).toBeCloseTo(cursor, 5)
      cursor += s.durationSec
    }
    expect(cursor).toBeCloseTo(60, 5)
  })
})
