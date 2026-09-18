import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAppleEditorHandoff } from '../../src/media/apple-editor-handoff.js'

describe('createAppleEditorHandoff', () => {
  it('packages masters, stems, captions, and a duplicate-free iMovie import set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spectra-apple-handoff-'))
    const long = join(root, 'long.mp4')
    const prores = join(root, 'long-prores.mov')
    const stem = join(root, 'narration.wav')
    const captions = join(root, 'captions.srt')
    await Promise.all([
      writeFile(long, 'web master'),
      writeFile(prores, 'edit master'),
      writeFile(stem, 'audio stem'),
      writeFile(captions, 'captions'),
    ])

    const result = await createAppleEditorHandoff([
      { path: long, role: 'web-master', imovieImport: true },
      { path: prores, role: 'edit-master' },
      { path: stem, role: 'audio-stem' },
      { path: captions, role: 'captions' },
    ], { outDir: join(root, 'handoff'), title: 'Easy Terminal', createdAt: '2026-09-18T00:00:00.000Z' })

    expect(result.manifest.files).toHaveLength(4)
    expect(result.manifest.files.every((file) => file.sha256.length === 64)).toBe(true)
    expect(await readFile(join(result.outDir, 'iMovie Import', 'long.mp4'), 'utf8')).toBe('web master')
    expect(await readFile(join(result.outDir, 'masters', 'long-prores.mov'), 'utf8')).toBe('edit master')
    expect(await readFile(result.readmePath, 'utf8')).toContain('Apple editors are optional finishing tools')
  })

  it('rejects non-video files marked for iMovie import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spectra-apple-handoff-'))
    const captions = join(root, 'captions.srt')
    await writeFile(captions, 'captions')

    await expect(createAppleEditorHandoff([
      { path: captions, role: 'captions', imovieImport: true },
    ], { outDir: join(root, 'handoff'), title: 'Invalid' })).rejects.toThrow('must be a video')
  })

  it('rejects colliding master and iMovie destinations before copying', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spectra-apple-handoff-'))
    const webDir = join(root, 'web')
    const editDir = join(root, 'edit')
    await Promise.all([mkdir(webDir), mkdir(editDir)])
    const web = join(webDir, 'master.mp4')
    const edit = join(editDir, 'master.mp4')
    await Promise.all([writeFile(web, 'web'), writeFile(edit, 'edit')])

    await expect(createAppleEditorHandoff([
      { path: web, role: 'web-master', imovieImport: true },
      { path: edit, role: 'edit-master', imovieImport: true },
    ], { outDir: join(root, 'handoff'), title: 'Collision' })).rejects.toThrow('Duplicate handoff destination')
  })
})
