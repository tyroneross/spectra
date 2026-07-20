import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  recordCompositeWithWorker,
  recoverCompositeOutput,
  type CompositeRecoveryManifest,
} from '../../src/daemon/composite-worker.js'
import { crashSafeMp4Args, detectFfmpeg } from '../../src/media/ffmpeg.js'

const ffmpeg = detectFfmpeg()
const workDirs: string[] = []

afterEach(async () => {
  await Promise.all(workDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function createRecoveryFixture(discoverable: boolean): Promise<{
  recoveryDirectory: string
  output: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'spectra-composite-recovery-test-'))
  workDirs.push(root)
  const output = join(root, 'recovered.mp4')
  const recoveryDirectory = join(
    root,
    discoverable ? 'recovered.mp4.spectra-recovery-test' : 'recovery',
  )
  await mkdir(recoveryDirectory)
  const left = join(recoveryDirectory, 'left.mp4')
  const right = join(recoveryDirectory, 'right.mp4')

  for (const [path, color] of [[left, 'red'], [right, 'blue']] as const) {
    const result = spawnSync(ffmpeg!, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:r=30:d=1.4`,
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      ...crashSafeMp4Args(),
      path,
    ], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
  }

  const manifest: CompositeRecoveryManifest = {
    schema: 'spectra.composite-recovery.v1',
    status: 'recording',
    output,
    left,
    right,
    fps: 30,
    durationSeconds: 1.4,
    paneHeight: 240,
    pixFmt: 'yuv420p',
    maxWidth: 640,
    crf: 20,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(join(recoveryDirectory, 'manifest.json'), JSON.stringify(manifest))
  return { recoveryDirectory, output }
}

function expectPlayableComposite(output: string): void {
  const probe = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    output,
  ], { encoding: 'utf8' })
  expect(probe.status, probe.stderr).toBe(0)
  expect(probe.stdout.trim()).toBe('640,240')
}

describe.skipIf(!ffmpeg)('composite crash recovery', () => {
  it('rebuilds a playable side-by-side output from fragmented pane recordings', async () => {
    const { recoveryDirectory, output } = await createRecoveryFixture(false)

    await recoverCompositeOutput(recoveryDirectory, output)

    expect((await stat(output)).size).toBeGreaterThan(1_000)
    expectPlayableComposite(output)
  }, 20_000)

  it('recovers a persisted manifest over a partial output before starting a new capture', async () => {
    const { recoveryDirectory, output } = await createRecoveryFixture(true)
    await writeFile(output, 'partial mp4 left by interrupted final encoding')

    const result = await recordCompositeWithWorker({
      appA: 'unused-during-recovery',
      appB: 'unused-during-recovery',
      outPath: output,
    })

    expect(result.ok).toBe(true)
    expect(result.output).toBe(output)
    expect(result.details).toMatchObject({ recoveryDirectory, recoveredFromFragments: true })
    expectPlayableComposite(output)
  }, 20_000)
})
