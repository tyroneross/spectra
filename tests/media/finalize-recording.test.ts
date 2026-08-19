// tests/media/finalize-recording.test.ts
//
// Guards the recording-finalize gate: every finalized recording must be a
// playable yuv420p + faststart mp4, and a stub / 4:4:4 / zero-duration source
// or output must fail loudly (throw) so no video artifact is registered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Hermetic: pretend ffmpeg is installed so tests never depend on the host.
vi.mock('../../src/media/ffmpeg.js', () => ({
  detectFfmpeg: () => '/usr/bin/ffmpeg',
  requireFfmpeg: () => '/usr/bin/ffmpeg',
}))

import {
  buildFinalizeArgs,
  finalizeRecording,
  RecordingFinalizeError,
} from '../../src/media/finalize-recording.js'
import { resetProcessRunner, setProcessRunner } from '../../src/media/pipeline.js'

type ProbeShape = {
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    pix_fmt?: string
    width?: number
    height?: number
    duration?: string
  }>
  format?: { duration?: string }
}

/** A ≥1KB buffer containing a `moov` atom marker so validation passes. */
function playableMp4Bytes(): Buffer {
  return Buffer.concat([Buffer.from('....ftypmoov....', 'ascii'), Buffer.alloc(2048)])
}

interface RunnerCall {
  cmd: string
  args: string[]
}

/**
 * Installs a mock process runner. `probeForPath` returns the ffprobe JSON for a
 * given input path (undefined => ffprobe fails). ffmpeg writes `outputBytes` to
 * its output path. All calls are recorded into `calls`.
 */
function installRunner(opts: {
  probeForPath: (path: string) => ProbeShape | undefined
  outputBytes?: () => Buffer
}): RunnerCall[] {
  const calls: RunnerCall[] = []
  const outputBytes = opts.outputBytes ?? playableMp4Bytes
  setProcessRunner((cmd, args) => {
    calls.push({ cmd, args })
    const target = args[args.length - 1]
    if (cmd === 'ffprobe') {
      const json = opts.probeForPath(target)
      return {
        kill: () => {},
        waitForExit: () => Promise.resolve(json ? 0 : 1),
        stdout: () => Promise.resolve(json ? JSON.stringify(json) : ''),
        stderr: () => Promise.resolve(''),
      }
    }
    // ffmpeg
    return {
      kill: () => {},
      waitForExit: () => {
        writeFileSync(target, outputBytes())
        return Promise.resolve(0)
      },
      stderr: () => Promise.resolve(''),
    }
  })
  return calls
}

const yuv420pStream = (over: Partial<ProbeShape['streams'][number]> = {}): ProbeShape => ({
  streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920, height: 1080, duration: '5.0', ...over }],
  format: { duration: '5.0' },
})

const fourFourFourStream = (): ProbeShape => ({
  // "High 4:4:4 Predictive" — the exact undecodable case this fix targets.
  streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'gbrp', width: 1920, height: 1080, duration: '5.0' }],
  format: { duration: '5.0' },
})

describe('buildFinalizeArgs', () => {
  it('transcode args pin yuv420p + faststart (mutation guard)', () => {
    const args = buildFinalizeArgs('/in.mp4', '/out.mp4', 'transcode', false)
    // If -pix_fmt yuv420p is dropped, this assertion fails — the point of the fix.
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p')
    expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart')
    expect(args).toContain('libx264')
    expect(args).toContain('-an')
  })

  it('transcode preserves audio when present', () => {
    const args = buildFinalizeArgs('/in.mp4', '/out.mp4', 'transcode', true)
    expect(args).toContain('-c:a')
    expect(args).toContain('aac')
    expect(args).not.toContain('-an')
  })

  it('remux copies the stream with faststart, no re-encode', () => {
    const args = buildFinalizeArgs('/in.mp4', '/out.mp4', 'remux', false)
    expect(args).toEqual(['-y', '-i', '/in.mp4', '-c', 'copy', '-movflags', '+faststart', '/out.mp4'])
    expect(args).not.toContain('libx264')
  })
})

describe('finalizeRecording', () => {
  let workDir: string
  let rawPath: string
  let outPath: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'spectra-finalize-'))
    rawPath = join(workDir, 'recording.raw.mp4')
    outPath = join(workDir, 'recording.mp4')
    // A raw file above the stub threshold so the size guard passes.
    writeFileSync(rawPath, Buffer.alloc(4096))
  })

  afterEach(() => {
    resetProcessRunner()
    rmSync(workDir, { recursive: true, force: true })
  })

  it('transcodes a 4:4:4 source into yuv420p with faststart', async () => {
    const calls = installRunner({
      probeForPath: (p) => (p === rawPath ? fourFourFourStream() : yuv420pStream()),
    })
    const result = await finalizeRecording({ rawPath, outPath })

    expect(result.action).toBe('transcode')
    expect(result.probe.pixFmt).toBe('yuv420p')
    const ffmpeg = calls.find((c) => c.cmd === 'ffmpeg')!
    expect(ffmpeg.args[ffmpeg.args.indexOf('-pix_fmt') + 1]).toBe('yuv420p')
    expect(ffmpeg.args).toContain('+faststart')
    expect(existsSync(outPath)).toBe(true)
  })

  it('takes the lossless remux fast-path for an already h264+yuv420p source', async () => {
    const calls = installRunner({ probeForPath: () => yuv420pStream() })
    const result = await finalizeRecording({ rawPath, outPath })

    expect(result.action).toBe('remux')
    const ffmpeg = calls.find((c) => c.cmd === 'ffmpeg')!
    expect(ffmpeg.args).toContain('copy')
    expect(ffmpeg.args).not.toContain('libx264')
  })

  it('throws (no artifact) when the source has no video stream', async () => {
    installRunner({ probeForPath: () => ({ streams: [], format: {} }) })
    await expect(finalizeRecording({ rawPath, outPath })).rejects.toBeInstanceOf(RecordingFinalizeError)
    expect(existsSync(outPath)).toBe(false)
  })

  it('throws (no artifact) when the source duration is zero', async () => {
    installRunner({
      // Zero stream duration AND no format duration to fall back on.
      probeForPath: () => ({
        streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920, height: 1080, duration: '0' }],
        format: {},
      }),
    })
    await expect(finalizeRecording({ rawPath, outPath })).rejects.toBeInstanceOf(RecordingFinalizeError)
    expect(existsSync(outPath)).toBe(false)
  })

  it('throws when the raw is a sub-1KB stub', async () => {
    writeFileSync(rawPath, Buffer.from('video')) // the exact 5-byte stub class
    installRunner({ probeForPath: () => yuv420pStream() })
    await expect(finalizeRecording({ rawPath, outPath })).rejects.toBeInstanceOf(RecordingFinalizeError)
  })

  it('throws when the finalized output is not yuv420p', async () => {
    // Source is 4:4:4 → transcode attempted, but output probe still reports 4:4:4.
    installRunner({
      probeForPath: (p) => (p === rawPath ? fourFourFourStream() : fourFourFourStream()),
    })
    await expect(finalizeRecording({ rawPath, outPath })).rejects.toThrow(/yuv420p/)
  })

  it('throws when the finalized output has no moov atom', async () => {
    installRunner({
      probeForPath: (p) => (p === rawPath ? fourFourFourStream() : yuv420pStream()),
      outputBytes: () => Buffer.alloc(4096), // >1KB but no moov marker
    })
    await expect(finalizeRecording({ rawPath, outPath })).rejects.toThrow(/moov/)
  })
})
