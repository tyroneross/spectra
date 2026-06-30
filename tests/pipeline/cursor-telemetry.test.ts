import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCursorTelemetry } from '../../src/pipeline/cursor-telemetry.js'

let workDir: string | null = null

async function makeWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), 'spectra-cursor-telemetry-'))
  return workDir
}

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('loadCursorTelemetry', () => {
  it('loads native sampler JSON as polishClip click and cursorPath shapes', async () => {
    const root = await makeWorkDir()
    const jsonPath = join(root, 'cursor.json')
    await writeFile(jsonPath, JSON.stringify({
      durationMs: 5000,
      samples: [
        { tMs: 0, cx: 0.4, cy: 0.3 },
        { tMs: 33, cx: 0.41, cy: 0.31 },
        { tMs: 67, cx: 0.42, cy: 0.32 },
      ],
      clicks: [
        { tMs: 40, cx: 0.41, cy: 0.31 },
      ],
    }))

    await expect(loadCursorTelemetry(jsonPath)).resolves.toEqual({
      cursorPath: [
        { tMs: 0, cx: 0.4, cy: 0.3 },
        { tMs: 33, cx: 0.41, cy: 0.31 },
        { tMs: 67, cx: 0.42, cy: 0.32 },
      ],
      clicks: [
        { tMs: 40, cx: 0.41, cy: 0.31 },
      ],
    })
  })

  it('rejects out-of-range normalized coordinates', async () => {
    const root = await makeWorkDir()
    const jsonPath = join(root, 'bad-cursor.json')
    await writeFile(jsonPath, JSON.stringify({
      durationMs: 100,
      samples: [{ tMs: 0, cx: 1.2, cy: 0.4 }],
      clicks: [],
    }))

    await expect(loadCursorTelemetry(jsonPath)).rejects.toThrow('samples[0].cx')
  })
})
