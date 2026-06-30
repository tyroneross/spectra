// tests/pipeline/polish-autozoom-wiring.test.ts
//
// C5a wiring test: polishClip must call deriveZoomTrackFromActivity (the
// auto-zoom default fill) only when clicksJson is empty and no cursorPath is
// given — explicit clicks (or a cursorPath) must skip it entirely so that
// path is byte-for-byte unchanged from before C5a. Mocks auto-zoom.js so
// this is deterministic and isolated from the auto-zoom module's own tests
// (kept in its own file: vitest mocks are per test-file).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const deriveZoomTrackFromActivityMock = vi.fn(async () => [{ tMs: 0, cx: 0.5, cy: 0.5 }])

vi.mock('../../src/pipeline/auto-zoom.js', () => ({
  deriveZoomTrackFromActivity: (...args: unknown[]) => deriveZoomTrackFromActivityMock(...args),
}))

import { polishClip } from '../../src/pipeline/polish.js'
import { ffmpegAvailable, makeTestVideo } from './ffmpeg-helpers.js'

let workDir: string | null = null
const ffmpegIt = ffmpegAvailable ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-polish-autozoom-'))
  return workDir
}

afterEach(async () => {
  deriveZoomTrackFromActivityMock.mockClear()
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('polishClip — auto-zoom default fill wiring', () => {
  ffmpegIt('calls deriveZoomTrackFromActivity with (input, durationMs) when clicksJson is empty', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.25)

    await polishClip({ input, clicksJson: JSON.stringify([]), outPath })

    expect(deriveZoomTrackFromActivityMock).toHaveBeenCalledTimes(1)
    const [calledInput, calledDurationMs] = deriveZoomTrackFromActivityMock.mock.calls[0]
    expect(calledInput).toBe(input)
    expect(typeof calledDurationMs).toBe('number')
  }, 30_000)

  ffmpegIt('does NOT call deriveZoomTrackFromActivity when explicit clicks are given (path unchanged)', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.25)

    await polishClip({
      input,
      clicksJson: JSON.stringify([{ tMs: 80, cx: 0.35, cy: 0.45 }]),
      outPath,
    })

    expect(deriveZoomTrackFromActivityMock).not.toHaveBeenCalled()
  }, 30_000)

  ffmpegIt('does NOT call deriveZoomTrackFromActivity when a cursorPath is given (path unchanged)', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.25)

    await polishClip({
      input,
      clicksJson: JSON.stringify({ clicks: [], cursorPath: [{ tMs: 0, cx: 0.4, cy: 0.4 }] }),
      outPath,
    })

    expect(deriveZoomTrackFromActivityMock).not.toHaveBeenCalled()
  }, 30_000)
})
