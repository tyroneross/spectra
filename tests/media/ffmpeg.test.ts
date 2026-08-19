import { describe, expect, it } from 'vitest'
import {
  CRASH_SAFE_MP4_MOVFLAGS,
  crashSafeMp4Args,
} from '../../src/media/ffmpeg.js'

describe('crashSafeMp4Args', () => {
  it('writes one-second fragmented MP4 output with forced keyframes', () => {
    const args = crashSafeMp4Args()

    expect(args).toContain('expr:gte(t,n_forced*1)')
    expect(args).toContain(CRASH_SAFE_MP4_MOVFLAGS)
    expect(args).toContain('1000000')
    expect(args).toContain('-flush_packets')
  })

  it('omits encoder-only keyframe flags for stream-copy outputs', () => {
    const args = crashSafeMp4Args({ forceKeyFrames: false })

    expect(args).not.toContain('-force_key_frames')
    expect(args).toContain(CRASH_SAFE_MP4_MOVFLAGS)
    expect(args).toContain('-frag_duration')
  })
})
