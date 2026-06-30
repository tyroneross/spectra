import { describe, expect, it } from 'vitest'
import { buildZoomTrack, type ZoomKeyframe } from '../../src/pipeline/zoom-keyframes.js'

function at(track: ZoomKeyframe[], frame: number): ZoomKeyframe {
  const point = track.find((candidate) => candidate.frame === frame)
  if (!point) throw new Error(`Missing frame ${frame}`)
  return point
}

describe('buildZoomTrack', () => {
  it('creates click segments with the validated pre/post window', () => {
    const track = buildZoomTrack([{ tMs: 1000, cx: 0.5, cy: 0.5 }], 5000, 10)

    expect(at(track, 6).scale).toBe(1)
    expect(at(track, 7).scale).toBe(1)
    expect(at(track, 16).scale).toBeCloseTo(1.45, 5)
    expect(at(track, 25).scale).toBeCloseTo(1.45, 5)
    expect(at(track, 35).scale).toBeCloseTo(1, 5)
    expect(at(track, 36).scale).toBe(1)
  })

  it('merges zoom segments whose gap is at most 2500ms', () => {
    const track = buildZoomTrack([
      { tMs: 1000, cx: 0.4, cy: 0.4 },
      { tMs: 6100, cx: 0.6, cy: 0.4 },
    ], 9000, 10)

    expect(at(track, 45).scale).toBeCloseTo(1.45, 5)
  })

  it('uses cubic smoothstep for the scale ramp', () => {
    const track = buildZoomTrack([{ tMs: 300, cx: 0.5, cy: 0.5 }], 3000, 100)

    expect(at(track, 0).scale).toBe(1)
    expect(at(track, 45).scale).toBeCloseTo(1.225, 3)
    expect(at(track, 90).scale).toBeCloseTo(1.45, 5)
  })

  it('clamps centers to the valid source area at the current zoom scale', () => {
    const track = buildZoomTrack([{ tMs: 300, cx: 0.05, cy: 0.95 }], 3000, 10)
    const fullZoom = at(track, 12)

    expect(fullZoom.scale).toBeCloseTo(1.45, 5)
    expect(fullZoom.cx).toBeCloseTo(0.5 / 1.45, 5)
    expect(fullZoom.cy).toBeCloseTo(1 - 0.5 / 1.45, 5)
  })

  it('ignores clicks in the final 1000ms', () => {
    const track = buildZoomTrack([{ tMs: 4500, cx: 0.5, cy: 0.5 }], 5000, 10)

    expect(track.every((point) => point.scale === 1)).toBe(true)
  })

  it('derives dwell fallback clicks from low-movement cursor runs', () => {
    const track = buildZoomTrack([], 5000, 10, {
      cursorPath: [
        { tMs: 1000, cx: 0.6, cy: 0.4 },
        { tMs: 1500, cx: 0.606, cy: 0.403 },
        { tMs: 2000, cx: 0.602, cy: 0.404 },
        { tMs: 2800, cx: 0.8, cy: 0.8 },
      ],
    })

    const zoomed = at(track, 24)
    expect(zoomed.scale).toBeGreaterThan(1.3)
    expect(zoomed.cx).toBeGreaterThan(0.58)
    expect(zoomed.cy).toBeLessThan(0.43)
  })
})
