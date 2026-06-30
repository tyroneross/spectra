import { describe, expect, it } from 'vitest'
import {
  atomizeScript,
  buildScriptZoomTrack,
  scaleScriptToDuration,
  scriptDurationMs,
  scriptZoomWindows,
  type DemoScript,
} from '../../src/pipeline/script.js'
import type { ZoomKeyframe } from '../../src/pipeline/zoom-keyframes.js'

function at(track: ZoomKeyframe[], frame: number): ZoomKeyframe {
  const point = track.find((candidate) => candidate.frame === frame)
  if (!point) throw new Error(`Missing frame ${frame}`)
  return point
}

describe('scripted demo schema helpers', () => {
  it('exports the Atomize storyboard as five timed beats', () => {
    expect(atomizeScript.title).toBe('Atomize AI')
    expect(atomizeScript.finalCaption).toBe('Atomize AI — the AI world, distilled daily')
    expect(scriptDurationMs(atomizeScript)).toBe(50_000)
    expect(atomizeScript.beats.map((beat) => beat.id)).toEqual(['hook', 'search', 'graph', 'brief', 'payoff'])
    expect(atomizeScript.beats[1]).toMatchObject({
      stepLabel: '①',
      stepText: 'Search the entire AI landscape',
      startMs: 5000,
      endMs: 16000,
      zoom: { cx: 0.30, cy: 0.10, scale: 1.5 },
      action: { kind: 'search', value: 'agentic frameworks' },
    })
  })

  it('scales script beats proportionally for short smoke clips', () => {
    const scaled = scaleScriptToDuration(atomizeScript, 7000)

    expect(scriptDurationMs(scaled)).toBe(7000)
    expect(scaled.beats.map((beat) => [beat.id, beat.startMs, beat.endMs])).toEqual([
      ['hook', 0, 700],
      ['search', 700, 2240],
      ['graph', 2240, 3920],
      ['brief', 3920, 5880],
      ['payoff', 5880, 7000],
    ])
  })

  it('derives per-beat zoom windows and eased frame tracks', () => {
    const script: DemoScript = {
      beats: [
        { id: 'one', stepText: 'One', startMs: 1000, endMs: 3000, zoom: { cx: 0.45, cy: 0.40, scale: 1.4 } },
        { id: 'two', stepText: 'Two', startMs: 4000, endMs: 6000, zoom: { cx: 0.55, cy: 0.45, scale: 1.2 } },
      ],
    }

    expect(scriptZoomWindows(script, 7000)).toEqual([
      { startMs: 1000, endMs: 3000, cx: 0.45, cy: 0.40, scale: 1.4 },
      { startMs: 4000, endMs: 6000, cx: 0.55, cy: 0.45, scale: 1.2 },
    ])

    const track = buildScriptZoomTrack(script, 7000, 10, { easeInMs: 500, easeOutMs: 500 })
    expect(at(track, 5)).toEqual({ frame: 5, scale: 1, cx: 0.5, cy: 0.5 })
    expect(at(track, 15)).toMatchObject({ frame: 15, scale: 1.4, cx: 0.45, cy: 0.4 })
    expect(at(track, 35)).toEqual({ frame: 35, scale: 1, cx: 0.5, cy: 0.5 })
    expect(at(track, 45)).toMatchObject({ frame: 45, scale: 1.2, cx: 0.55, cy: 0.45 })
  })
})
