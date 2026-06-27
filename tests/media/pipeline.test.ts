// tests/media/pipeline.test.ts
//
// Covers the LIVE pipeline surface after the daemon-consolidation cutover (P3):
// video probing + poster-frame extraction. The full-display recording path
// (buildCaptureArgs / buildEncodeArgs / buildCompositeEncodeArgs / startRecording
// / encodeRecording / avfoundation discovery) was deleted with its registry; the
// daemon composite worker owns recording now.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  buildPosterFrameArgs,
  buildProbeArgs,
  extractPosterFrame,
  probeVideo,
  setProcessRunner,
  resetProcessRunner,
} from '../../src/media/pipeline.js'
import { tmpdir } from 'node:os'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

describe('video probing and posters', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'spectra-pipeline-'))
  })

  afterEach(() => {
    resetProcessRunner()
    rmSync(workDir, { recursive: true, force: true })
  })

  it('buildProbeArgs requests machine-readable stream and format metadata', () => {
    const args = buildProbeArgs('/tmp/video.mp4')
    expect(args).toContain('-of')
    expect(args[args.indexOf('-of') + 1]).toBe('json')
    expect(args).toContain('-show_entries')
    expect(args).toContain('/tmp/video.mp4')
  })

  it('buildPosterFrameArgs extracts one scaled PNG frame', () => {
    const args = buildPosterFrameArgs('/tmp/video.mp4', '/tmp/poster.png', { atSeconds: 2, maxWidth: 900 })
    expect(args).toEqual(expect.arrayContaining([
      '-ss',
      '2',
      '-frames:v',
      '1',
      '-q:v',
      '2',
      '/tmp/poster.png',
    ]))
    expect(args).toContain('scale=min(900\\,iw):-2')
  })

  it('probeVideo parses duration, dimensions, codec, and rational FPS', async () => {
    setProcessRunner((_cmd, _args) => ({
      kill: () => {},
      waitForExit: () => Promise.resolve(0),
      stdout: () => Promise.resolve(JSON.stringify({
        streams: [
          {
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30000/1001',
          },
        ],
        format: { duration: '12.345' },
      })),
    }))

    await expect(probeVideo('/tmp/video.mp4')).resolves.toEqual({
      codec: 'h264',
      width: 1920,
      height: 1080,
      fps: 29.97,
      durationMs: 12345,
    })
  })

  it('extractPosterFrame writes through the configured ffmpeg runner', async () => {
    const posterPath = join(workDir, 'poster.png')
    setProcessRunner((_cmd, args) => ({
      kill: () => {},
      waitForExit: () => {
        writeFileSync(args[args.length - 1], 'poster')
        return Promise.resolve(0)
      },
    }))

    await extractPosterFrame('/tmp/video.mp4', posterPath)
    expect(existsSync(posterPath)).toBe(true)
  })
})
