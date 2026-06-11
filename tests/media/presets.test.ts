// tests/media/presets.test.ts

import { describe, expect, it } from 'vitest'
import {
  CAPTURE_PRESETS,
  resolveRecordingCaptureOptions,
  resolveScreenshotCaptureOptions,
} from '../../src/media/presets.js'

describe('capture presets', () => {
  it('defines production-oriented presets for common asset lanes', () => {
    expect(Object.keys(CAPTURE_PRESETS).sort()).toEqual([
      'app-store',
      'demo',
      'docs',
      'social',
    ])
    expect(CAPTURE_PRESETS.demo.productionReady).toBe(true)
  })

  it('resolves screenshot defaults from the selected preset', () => {
    const options = resolveScreenshotCaptureOptions({ preset: 'social' })

    expect(options).toEqual({
      preset: 'social',
      productionReady: true,
      mode: 'auto',
      aspectRatio: '9:16',
      clean: true,
      quality: 'high',
    })
  })

  it('lets explicit screenshot options override preset defaults', () => {
    const options = resolveScreenshotCaptureOptions({
      preset: 'social',
      mode: 'full',
      aspectRatio: '1:1',
      clean: false,
      quality: 'lossless',
    })

    expect(options.mode).toBe('full')
    expect(options.aspectRatio).toBe('1:1')
    expect(options.clean).toBe(false)
    expect(options.quality).toBe('lossless')
  })

  it('resolves recording defaults and keeps explicit controls authoritative', () => {
    const options = resolveRecordingCaptureOptions({
      preset: 'demo',
      fps: 30,
      quality: 'lossless',
      hardware: false,
    })

    expect(options).toEqual({
      fps: 30,
      quality: 'lossless',
      hardware: false,
      codec: 'h264',
      bitrate: '8M',
    })
  })

  it('does not inject recording options without a preset or explicit overrides', () => {
    expect(resolveRecordingCaptureOptions({})).toEqual({})
  })
})
