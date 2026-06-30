// tests/mcp/server.test.ts
//
// f1 activation-path proof: validates polish-clip / polish-script / a
// record-composite spotlight enum payload against the ACTUAL zod input
// shape passed to `server.tool('spectra_demo', <description>, <shape>, ...)`
// in src/mcp/server.ts (exported as `spectraDemoInputShape`). A prior pass
// only tested src/mcp/tools/demo.ts's `handleDemo` directly, which never
// proves the MCP SDK boundary itself accepts these actions — the SDK
// validates server.tool()'s third argument BEFORE forward()/handleDemo ever
// run, so a flat action enum missing 'polish-clip'/'polish-script' (or a
// `spotlight` field that can't be both the record-composite enum and the
// polish-clip object) would reject these payloads at the door even though
// forward.ts/schemas.ts/the handler are all correctly wired downstream.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { spectraDemoInputShape } from '../../src/mcp/server.js'

const spectraDemoInputSchema = z.object(spectraDemoInputShape)

describe('spectra_demo MCP input shape — activation-path boundary (f1)', () => {
  it('parses a polish-clip payload with an inline clicksJson array', () => {
    const result = spectraDemoInputSchema.parse({
      action: 'polish-clip',
      input: 'x.mp4',
      clicksJson: '[]',
      out: 'o.mp4',
    })
    expect(result.action).toBe('polish-clip')
  })

  it('parses a polish-clip payload with an array clicksJson and an object spotlight', () => {
    const result = spectraDemoInputSchema.parse({
      action: 'polish-clip',
      input: 'x.mp4',
      clicksJson: [{ tMs: 0, cx: 0.5, cy: 0.5 }],
      out: 'o.mp4',
      caption: 'hello',
      fps: 30,
      spotlight: { focal: { x: 10, y: 10, w: 100, h: 100 }, dim: 0.5 },
    })
    expect(result.action).toBe('polish-clip')
    expect(result.spotlight).toEqual({ focal: { x: 10, y: 10, w: 100, h: 100 }, dim: 0.5 })
  })

  it('parses a polish-script payload with a multi-beat script', () => {
    const result = spectraDemoInputSchema.parse({
      action: 'polish-script',
      input: 'x.mp4',
      out: 'o.mp4',
      fps: 60,
      script: {
        title: 'Demo',
        finalCaption: 'Done',
        beats: [
          { id: 'b1', startMs: 0, endMs: 1000, stepLabel: '1', stepText: 'Open the app' },
          { id: 'b2', startMs: 1000, endMs: 2000, zoom: { cx: 0.5, cy: 0.5, scale: 1.5 } },
        ],
      },
    })
    expect(result.action).toBe('polish-script')
  })

  it('still parses a record-composite payload with the spotlight ENUM value (no collision with polish-clip object spotlight)', () => {
    const result = spectraDemoInputSchema.parse({
      action: 'record-composite',
      appA: 'AppA',
      appB: 'AppB',
      spotlight: 'a',
    })
    expect(result.action).toBe('record-composite')
    expect(result.spotlight).toBe('a')
  })

  it('still parses the pre-existing scan/polish/auto-ramp actions unchanged', () => {
    expect(spectraDemoInputSchema.parse({ action: 'scan', input: 'x.mp4' }).action).toBe('scan')
    expect(spectraDemoInputSchema.parse({ action: 'auto-ramp', input: 'x.mp4', out: 'o.mp4' }).action).toBe('auto-ramp')
  })

  it('rejects an unknown action at the boundary', () => {
    expect(() => spectraDemoInputSchema.parse({ action: 'not-a-real-action' })).toThrow()
  })
})
