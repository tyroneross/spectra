// tests/pipeline/auto-zoom.test.ts
//
// C5a: deriveZoomTrackFromActivity synthesizes a ZoomClick[] from
// scanActivity's temporal activeRanges so polishClip can auto-zoom an
// unedited recording. Mocks media/spotlight.js's scanActivity so this runs
// deterministically without a real ffmpeg binary or video file.
import { describe, expect, it, vi } from 'vitest'

const scanActivityMock = vi.fn()

vi.mock('../../src/media/spotlight.js', () => ({
  scanActivity: (...args: unknown[]) => scanActivityMock(...args),
}))

import { deriveZoomTrackFromActivity } from '../../src/pipeline/auto-zoom.js'

describe('deriveZoomTrackFromActivity', () => {
  it('returns an empty array when scanActivity finds no activity', async () => {
    scanActivityMock.mockResolvedValueOnce({ perMinute: [], activeRanges: [] })
    const clicks = await deriveZoomTrackFromActivity('in.mp4', 10_000)
    expect(clicks).toEqual([])
  })

  it('synthesizes one click per active range, anchored at the range start, defaulting to center', async () => {
    scanActivityMock.mockResolvedValueOnce({
      perMinute: [],
      activeRanges: [
        { startSec: 2, endSec: 5 },
        { startSec: 12, endSec: 14 },
      ],
    })
    const clicks = await deriveZoomTrackFromActivity('in.mp4', 20_000)
    expect(clicks).toEqual([
      { tMs: 2000, cx: 0.5, cy: 0.5 },
      { tMs: 12000, cx: 0.5, cy: 0.5 },
    ])
  })

  it('honors a custom anchor for every synthesized click', async () => {
    scanActivityMock.mockResolvedValueOnce({
      perMinute: [],
      activeRanges: [{ startSec: 1, endSec: 3 }],
    })
    const clicks = await deriveZoomTrackFromActivity('in.mp4', 10_000, { anchor: { cx: 0.2, cy: 0.8 } })
    expect(clicks).toEqual([{ tMs: 1000, cx: 0.2, cy: 0.8 }])
  })

  it('forwards a custom threshold to scanActivity', async () => {
    scanActivityMock.mockResolvedValueOnce({ perMinute: [], activeRanges: [] })
    await deriveZoomTrackFromActivity('in.mp4', 10_000, { threshold: 0.1 })
    expect(scanActivityMock).toHaveBeenCalledWith('in.mp4', { threshold: 0.1 })
  })

  it('drops a synthesized click that would fall at/after the clip duration', async () => {
    scanActivityMock.mockResolvedValueOnce({
      perMinute: [],
      activeRanges: [
        { startSec: 1, endSec: 2 },
        { startSec: 9.5, endSec: 9.9 },
      ],
    })
    const clicks = await deriveZoomTrackFromActivity('in.mp4', 9_000)
    expect(clicks).toEqual([{ tMs: 1000, cx: 0.5, cy: 0.5 }])
  })
})
