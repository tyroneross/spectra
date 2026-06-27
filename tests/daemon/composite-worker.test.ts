// tests/daemon/composite-worker.test.ts
//
// Coverage for the ACTIVE window-isolated composite recorder path
// (src/daemon/composite-worker.ts). The MCP `spectra_demo action=record-composite`
// call forwards to the daemon, which dispatches CoreApiImpl.recordComposite ->
// recordCompositeWithWorker. These pure helpers (param->flag mapping and the
// black-frame luminance guard) had no direct test before; this file covers them.
import { describe, it, expect } from 'vitest'
import {
  buildCompositeWorkerArgs,
  parseLuminance,
  COMPOSITE_WORKER_DEFAULTS,
} from '../../src/daemon/composite-worker.js'
import type { RecordCompositeParams } from '../../src/contract/core-api.js'

const base: RecordCompositeParams = {
  appA: 'Claude',
  appB: 'Terminal',
  outPath: '/tmp/out.mp4',
}

/** Read the value following a flag in an argv array. */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

describe('buildCompositeWorkerArgs — required fields', () => {
  it('maps the three required fields to --app-a / --app-b / --out', () => {
    const args = buildCompositeWorkerArgs(base)
    expect(flagValue(args, '--app-a')).toBe('Claude')
    expect(flagValue(args, '--app-b')).toBe('Terminal')
    expect(flagValue(args, '--out')).toBe('/tmp/out.mp4')
  })

  it('throws when appA is missing', () => {
    expect(() => buildCompositeWorkerArgs({ ...base, appA: '' })).toThrow(/appA/)
  })
  it('throws when appB is missing', () => {
    expect(() => buildCompositeWorkerArgs({ ...base, appB: '' })).toThrow(/appB/)
  })
  it('throws when outPath is missing', () => {
    expect(() => buildCompositeWorkerArgs({ ...base, outPath: '' })).toThrow(/outPath/)
  })
})

describe('buildCompositeWorkerArgs — defaults', () => {
  it('applies fps / duration / spotlight / maxWidth / crf defaults', () => {
    const args = buildCompositeWorkerArgs(base)
    expect(flagValue(args, '--fps')).toBe(String(COMPOSITE_WORKER_DEFAULTS.fps))
    expect(flagValue(args, '--duration')).toBe(String(COMPOSITE_WORKER_DEFAULTS.durationSeconds))
    expect(flagValue(args, '--spotlight')).toBe(COMPOSITE_WORKER_DEFAULTS.spotlight)
    expect(flagValue(args, '--max-width')).toBe(String(COMPOSITE_WORKER_DEFAULTS.maxWidth))
    expect(flagValue(args, '--crf')).toBe(String(COMPOSITE_WORKER_DEFAULTS.crf))
  })

  it('emits --cursor by default (cursor on)', () => {
    expect(buildCompositeWorkerArgs(base)).toContain('--cursor')
    expect(buildCompositeWorkerArgs(base)).not.toContain('--no-cursor')
  })
})

describe('buildCompositeWorkerArgs — explicit values', () => {
  it('threads every optional flag through', () => {
    const args = buildCompositeWorkerArgs({
      ...base,
      titleA: 'Session',
      labelA: 'Agent',
      titleB: 'zsh',
      labelB: 'Shell',
      durationSeconds: 12,
      fps: 30,
      spotlight: 'b',
      maxWidth: 1280,
      crf: 18,
    })
    expect(flagValue(args, '--title-a')).toBe('Session')
    expect(flagValue(args, '--label-a')).toBe('Agent')
    expect(flagValue(args, '--title-b')).toBe('zsh')
    expect(flagValue(args, '--label-b')).toBe('Shell')
    expect(flagValue(args, '--duration')).toBe('12')
    expect(flagValue(args, '--fps')).toBe('30')
    expect(flagValue(args, '--spotlight')).toBe('b')
    expect(flagValue(args, '--max-width')).toBe('1280')
    expect(flagValue(args, '--crf')).toBe('18')
  })

  it('emits --no-cursor when cursor is false', () => {
    const args = buildCompositeWorkerArgs({ ...base, cursor: false })
    expect(args).toContain('--no-cursor')
    expect(args).not.toContain('--cursor')
  })

  it('omits optional title/label flags when not provided', () => {
    const args = buildCompositeWorkerArgs(base)
    expect(args).not.toContain('--title-a')
    expect(args).not.toContain('--label-a')
    expect(args).not.toContain('--title-b')
    expect(args).not.toContain('--label-b')
  })
})

describe('parseLuminance — black-frame guard', () => {
  it('flags all-black output below threshold', () => {
    const out = [
      'lavfi.signalstats.YAVG=0.000',
      'lavfi.signalstats.YAVG=1.200',
      'lavfi.signalstats.YAVG=0.500',
    ].join('\n')
    const g = parseLuminance(out)
    expect(g.sampleCount).toBe(3)
    expect(g.allBlack).toBe(true)
    expect(g.skipped).toBe(false)
    expect(g.meanLuma).toBeLessThan(COMPOSITE_WORKER_DEFAULTS.blackThreshold)
  })

  it('passes normal-luminance output', () => {
    const out = [
      'lavfi.signalstats.YAVG=110.0',
      'lavfi.signalstats.YAVG=128.5',
      'lavfi.signalstats.YAVG=95.2',
    ].join('\n')
    const g = parseLuminance(out)
    expect(g.allBlack).toBe(false)
    expect(g.skipped).toBe(false)
    expect(g.meanLuma).toBeGreaterThan(COMPOSITE_WORKER_DEFAULTS.blackThreshold)
  })

  it('marks the guard skipped when no YAVG samples are present', () => {
    const g = parseLuminance('ffmpeg version 7.0\nno metadata here')
    expect(g.sampleCount).toBe(0)
    expect(g.meanLuma).toBeNull()
    expect(g.allBlack).toBe(false)
    expect(g.skipped).toBe(true)
  })

  it('honors a custom black threshold', () => {
    const out = 'lavfi.signalstats.YAVG=20.0'
    expect(parseLuminance(out, 16).allBlack).toBe(false)
    expect(parseLuminance(out, 32).allBlack).toBe(true)
  })
})
