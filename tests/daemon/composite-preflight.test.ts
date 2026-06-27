import { describe, expect, it } from 'vitest'
import { parseScreenRecordingPreflightOutput } from '../../src/daemon/composite-worker.js'

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
})
