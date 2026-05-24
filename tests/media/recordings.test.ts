// tests/media/recordings.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordings } from '../../src/media/recordings.js'
import { setProcessRunner, resetProcessRunner, type ProcessRunner } from '../../src/media/pipeline.js'

let workDir: string

function fakeRunnerFactory(): { runner: ProcessRunner, calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const runner: ProcessRunner = (cmd, args) => {
    calls.push({ cmd, args })
    // The capture process needs to write a stub file at args[args.length - 1] so
    // the encoder step (which reads it) finds a file. For the encoder we also
    // write the output file at args[args.length - 1].
    const outputPath = args[args.length - 1]
    if (outputPath && (outputPath.endsWith('.mkv') || outputPath.endsWith('.mp4'))) {
      writeFileSync(outputPath, 'fake media bytes')
    }
    return {
      kill: () => { /* noop */ },
      waitForExit: () => Promise.resolve(0),
    }
  }
  return { runner, calls }
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'spectra-rec-test-'))
  recordings._reset()
})

afterEach(() => {
  resetProcessRunner()
  rmSync(workDir, { recursive: true, force: true })
})

describe('RecordingRegistry', () => {
  it('start → returns recordingId + startedAt + effective options', async () => {
    const { runner } = fakeRunnerFactory()
    setProcessRunner(runner)

    const r = await recordings.start({
      sessionId: 'sess-a',
      platform: 'macos',
      outputDir: workDir,
      options: { fps: 60, quality: 'medium', hardware: false },
    })

    expect(r.recordingId).toMatch(/^[a-f0-9]{8}$/)
    expect(r.startedAt).toBeGreaterThan(0)
    expect(r.options.fps).toBe(60)
    expect(r.options.quality).toBe('medium')
    expect(r.options.hardware).toBe(false)
    expect(recordings.has('sess-a')).toBe(true)
  })

  it('start twice on same session → throws', async () => {
    const { runner } = fakeRunnerFactory()
    setProcessRunner(runner)

    await recordings.start({ sessionId: 's', platform: 'macos', outputDir: workDir })
    await expect(
      recordings.start({ sessionId: 's', platform: 'macos', outputDir: workDir })
    ).rejects.toThrow(/already active/)
  })

  it('start → stop returns path, duration, size', async () => {
    const { runner } = fakeRunnerFactory()
    setProcessRunner(runner)

    await recordings.start({ sessionId: 's', platform: 'macos', outputDir: workDir })
    await new Promise<void>((r) => setTimeout(r, 5))
    const stopped = await recordings.stop({ sessionId: 's', outputDir: workDir })

    expect(stopped.path).toMatch(/\.mp4$/)
    expect(stopped.durationMs).toBeGreaterThanOrEqual(0)
    expect(stopped.sizeBytes).toBeGreaterThan(0)
    expect(stopped.alreadyStopped).toBe(false)
    expect(stopped.codec).toMatch(/(libx264|h264_videotoolbox)/)
    expect(stopped.fps).toBe(30)
  })

  it('stop twice → second is alreadyStopped: true', async () => {
    const { runner } = fakeRunnerFactory()
    setProcessRunner(runner)

    await recordings.start({ sessionId: 's', platform: 'macos', outputDir: workDir })
    const first = await recordings.stop({ sessionId: 's', outputDir: workDir })
    const second = await recordings.stop({ sessionId: 's', outputDir: workDir })

    expect(first.alreadyStopped).toBe(false)
    expect(second.alreadyStopped).toBe(true)
    expect(second.path).toBe(first.path)
  })

  it('stop with no active recording → throws', async () => {
    await expect(
      recordings.stop({ sessionId: 'missing', outputDir: workDir })
    ).rejects.toThrow(/No active recording/)
  })

  it('abort → removes registry entry without throwing', async () => {
    const { runner } = fakeRunnerFactory()
    setProcessRunner(runner)
    await recordings.start({ sessionId: 's', platform: 'macos', outputDir: workDir })
    expect(recordings.has('s')).toBe(true)
    await recordings.abort('s')
    expect(recordings.has('s')).toBe(false)
  })

  it('forwards codec/bitrate/fps options to ffmpeg argv', async () => {
    const { runner, calls } = fakeRunnerFactory()
    setProcessRunner(runner)

    await recordings.start({
      sessionId: 's',
      platform: 'macos',
      outputDir: workDir,
      options: { fps: 60, quality: 'high', hardware: true },
    })
    await recordings.stop({ sessionId: 's', outputDir: workDir })

    // First call = capture, second = encode
    expect(calls.length).toBe(2)
    expect(calls[0].args).toContain('-framerate')
    expect(calls[0].args).toContain('60')
    // Encode call uses hardware encoder since hardware=true and quality!=lossless
    expect(calls[1].args).toContain('h264_videotoolbox')
  })
})
