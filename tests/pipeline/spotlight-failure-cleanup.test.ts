// tests/pipeline/spotlight-failure-cleanup.test.ts
//
// f3 regression test: renderSpotlightPrePass must remove its
// spectra-spotlight-<uuid>.mp4 temp output when the ffmpeg pass rejects,
// instead of leaving a partial file orphaned in tmpdir. Mocks
// node:child_process + node:fs/promises + media/ffmpeg.js so this runs
// deterministically without a real ffmpeg binary or real I/O.
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; stdout: EventEmitter }
    proc.stderr = new EventEmitter()
    proc.stdout = new EventEmitter()
    // Simulate ffmpeg writing an error then exiting non-zero, asynchronously
    // (mirrors real child_process timing — listeners attach before events fire).
    queueMicrotask(() => {
      proc.stderr.emit('data', Buffer.from('Error: invalid filter graph\n'))
      proc.emit('close', 1)
    })
    return proc
  }),
}))

vi.mock('node:fs/promises', () => ({
  rm: vi.fn(async () => {}),
}))

vi.mock('../../src/media/ffmpeg.js', () => ({
  requireFfmpeg: vi.fn(() => 'ffmpeg'),
}))

import { rm } from 'node:fs/promises'
import { renderSpotlightPrePass } from '../../src/pipeline/spotlight.js'

describe('renderSpotlightPrePass — failure cleanup (f3)', () => {
  it('removes the partial temp output (rm force:true) before rethrowing when ffmpeg exits non-zero', async () => {
    await expect(
      renderSpotlightPrePass({
        input: 'in.mp4',
        canvas: { w: 100, h: 100 },
        focal: { x: 0, y: 0, w: 50, h: 50 },
        hasAudio: false,
      }),
    ).rejects.toThrow(/ffmpeg exited with code 1/)

    expect(rm).toHaveBeenCalledTimes(1)
    const [calledPath, calledOpts] = vi.mocked(rm).mock.calls[0]
    expect(calledPath).toMatch(/spectra-spotlight-.*\.mp4$/)
    expect(calledOpts).toEqual({ force: true })
  })
})
