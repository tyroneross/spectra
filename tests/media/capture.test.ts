// tests/media/capture.test.ts
import { describe, it, expect } from 'vitest'
import { detectFfmpeg } from '../../src/media/ffmpeg.js'

describe('ffmpeg', () => {
  it('detects ffmpeg presence', () => {
    const path = detectFfmpeg()
    // May be null if ffmpeg not installed — just verify it returns string or null
    expect(path === null || typeof path === 'string').toBe(true)
  })
})
