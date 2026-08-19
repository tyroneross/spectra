import { describe, expect, it, vi } from 'vitest'

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: spawnSyncMock,
}))

vi.mock('../../src/native/compiler.js', () => ({
  ensureCompositeBinary: () => '/fake/bundle/spectra-composite-capture',
  ensureScreenRecordingPreflightBinary: () => '/fake/bundle/spectra-screen-recording-preflight',
}))

import {
  parseScreenRecordingPreflightOutput,
  recordCompositeWithWorker,
} from '../../src/daemon/composite-worker.js'

describe('composite screen recording preflight', () => {
  it('parses typed permission-denied output from the native helper', () => {
    const output = [
      'diagnostic line',
      JSON.stringify({
        ok: false,
        error: {
          code: 'permission_denied',
          message: 'Screen Recording not granted to Spectra.',
          hint: 'Enable Screen Recording for the signed Spectra daemon helper in System Settings > Privacy & Security > Screen Recording, then retry.',
          retryable: false,
          details: {
            nativeCode: 'screen_recording_not_granted',
            permission: 'screen-recording',
          },
        },
      }),
    ].join('\n')

    expect(parseScreenRecordingPreflightOutput(output)).toEqual({
      code: 'permission_denied',
      message: 'Screen Recording not granted to Spectra.',
      hint: 'Enable Screen Recording for the signed Spectra daemon helper in System Settings > Privacy & Security > Screen Recording, then retry.',
      retryable: false,
      details: {
        nativeCode: 'screen_recording_not_granted',
        permission: 'screen-recording',
      },
    })
  })

  it('passes --no-request to the composite status preflight', async () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: '',
    })

    const result = await recordCompositeWithWorker({
      appA: 'Safari',
      appB: 'Notes',
      outPath: '/tmp/composite.mp4',
    })

    expect(result.ok).toBe(false)
    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/fake/bundle/spectra-screen-recording-preflight',
      ['--no-request'],
      expect.objectContaining({ encoding: 'utf8' }),
    )
  })
})
