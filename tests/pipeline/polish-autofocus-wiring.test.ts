// tests/pipeline/polish-autofocus-wiring.test.ts
//
// autoFocus wiring test: polishClip/polishScript must resolve a focal rect
// via window-focus.ts's resolveFocalRect when `autoFocus` is set and no
// explicit `spotlight.focal` is given, then feed that rect into the existing
// dark-crush spotlight pre-pass (renderSpotlightPrePass). Absent `autoFocus`
// must leave today's behavior byte-for-byte unchanged (no resolveFocalRect
// call, no spotlight pre-pass). A `resolveFocalRect` that can't resolve a
// window (missing binary, no GUI session) must fall back to "no spotlight"
// rather than fail the render.
//
// Mocks window-focus.js (deterministic focal-rect resolution, no real native
// binary) and spies on spotlight.js's renderSpotlightPrePass via
// vi.importActual so the real dark-crush ffmpeg pass still runs — this test
// asserts on the *args* it was called with, not just that a pre-pass ran.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FocalRect } from '../../src/media/spotlight.js'

const resolveFocalRectMock = vi.fn<(opts: unknown) => Promise<FocalRect | undefined>>()

vi.mock('../../src/pipeline/window-focus.js', () => ({
  resolveFocalRect: (...args: unknown[]) => resolveFocalRectMock(...(args as [unknown])),
}))

vi.mock('../../src/pipeline/spotlight.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/pipeline/spotlight.js')>(
    '../../src/pipeline/spotlight.js',
  )
  return {
    ...actual,
    renderSpotlightPrePass: vi.fn(actual.renderSpotlightPrePass),
  }
})

import { polishClip, polishScript } from '../../src/pipeline/polish.js'
import { renderSpotlightPrePass } from '../../src/pipeline/spotlight.js'
import { ffmpegAvailable, makeTestVideo } from './ffmpeg-helpers.js'

const renderSpotlightPrePassMock = vi.mocked(renderSpotlightPrePass)

let workDir: string | null = null
const ffmpegIt = ffmpegAvailable ? it : it.skip

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-polish-autofocus-'))
  return workDir
}

afterEach(async () => {
  resolveFocalRectMock.mockReset()
  renderSpotlightPrePassMock.mockClear()
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('polishClip — autoFocus wiring', () => {
  ffmpegIt('resolves a focal rect via resolveFocalRect and feeds it to the spotlight pre-pass', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.2)

    const focal: FocalRect = { x: 8, y: 4, w: 32, h: 18 }
    resolveFocalRectMock.mockResolvedValue(focal)

    await polishClip({
      input,
      clicksJson: JSON.stringify([]),
      outPath,
      autoFocus: true,
    })

    expect(resolveFocalRectMock).toHaveBeenCalledTimes(1)
    expect(resolveFocalRectMock).toHaveBeenCalledWith(
      expect.objectContaining({ app: undefined, title: undefined, canvas: { w: 64, h: 36 } }),
    )
    expect(renderSpotlightPrePassMock).toHaveBeenCalledTimes(1)
    expect(renderSpotlightPrePassMock.mock.calls[0][0]).toMatchObject({ focal })
  }, 30_000)

  ffmpegIt('passes app/title filters through to resolveFocalRect', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.2)

    resolveFocalRectMock.mockResolvedValue({ x: 0, y: 0, w: 20, h: 20 })

    await polishClip({
      input,
      clicksJson: JSON.stringify([]),
      outPath,
      autoFocus: { app: 'Safari', title: 'GitHub' },
    })

    expect(resolveFocalRectMock).toHaveBeenCalledWith(
      expect.objectContaining({ app: 'Safari', title: 'GitHub' }),
    )
  }, 30_000)

  ffmpegIt('an explicit spotlight.focal wins over autoFocus (autoFocus never consulted)', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.2)

    const explicitFocal: FocalRect = { x: 1, y: 1, w: 10, h: 10 }

    await polishClip({
      input,
      clicksJson: JSON.stringify([]),
      outPath,
      spotlight: { focal: explicitFocal },
      autoFocus: true,
    })

    expect(resolveFocalRectMock).not.toHaveBeenCalled()
    expect(renderSpotlightPrePassMock.mock.calls[0][0]).toMatchObject({ focal: explicitFocal })
  }, 30_000)

  ffmpegIt('absent autoFocus is unchanged: no resolveFocalRect call, no spotlight pre-pass', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.2)

    await polishClip({
      input,
      clicksJson: JSON.stringify([]),
      outPath,
    })

    expect(resolveFocalRectMock).not.toHaveBeenCalled()
    expect(renderSpotlightPrePassMock).not.toHaveBeenCalled()
  }, 30_000)

  ffmpegIt('falls back to no spotlight when resolveFocalRect cannot resolve a window (missing binary/no GUI)', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.2)

    resolveFocalRectMock.mockResolvedValue(undefined)

    const result = await polishClip({
      input,
      clicksJson: JSON.stringify([]),
      outPath,
      autoFocus: true,
    })

    expect(resolveFocalRectMock).toHaveBeenCalledTimes(1)
    expect(renderSpotlightPrePassMock).not.toHaveBeenCalled()
    expect(result.outPath).toBe(outPath)
  }, 30_000)
})

describe('polishScript — autoFocus wiring', () => {
  ffmpegIt('resolves a focal rect via resolveFocalRect and feeds it to the spotlight pre-pass', async () => {
    const root = await makeWorkDir()
    const input = join(root, 'input.mp4')
    const outPath = join(root, 'polished.mp4')
    await makeTestVideo(input, 64, 36, 0.2)

    const focal: FocalRect = { x: 4, y: 2, w: 16, h: 9 }
    resolveFocalRectMock.mockResolvedValue(focal)

    await polishScript({
      input,
      script: { beats: [] },
      outPath,
      autoFocus: { app: 'Notes' },
    })

    expect(resolveFocalRectMock).toHaveBeenCalledWith(expect.objectContaining({ app: 'Notes' }))
    expect(renderSpotlightPrePassMock.mock.calls[0][0]).toMatchObject({ focal })
  }, 30_000)
})
