import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { findChrome } from '../../src/cdp/browser.js'
import { detectFfmpeg } from '../../src/media/ffmpeg.js'
import { storySchema, type StoryInput } from '../../src/pipeline/story-schema.js'
import { composeStory, getStoryStatus, startStoryJob, stopStoryJobs } from '../../src/pipeline/story.js'
import { ffmpeg, runProcess } from '../../src/pipeline/story-process.js'
import { polishScript } from '../../src/pipeline/polish.js'
import { renderHtmlFrames } from '../../src/pipeline/html-render.js'
const available = !!findChrome() && !!detectFfmpeg()
const dirs: string[] = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'spectra-story-test-')); dirs.push(dir)
  const entry = join(dir, 'scene.html')
  await writeFile(entry, `<!doctype html><style>body{margin:0;background:#0a1020}#dot{width:40px;height:40px;position:absolute}</style><div id="dot"></div><script>
    window.renderFrame=async(ms)=>{dot.style.left=(ms/5)+'px';dot.style.top='30px';dot.style.background='rgb('+Math.floor(Math.random()*255)+',120,220)';document.body.dataset.time=Date.now();};
  </script>`)
  const story: StoryInput = { schemaVersion: 1, id: 'test', title: 'Evidence and explanation', fps: 10, canvas: { width: 320, height: 180 },
    scenes: [{ id: 'idea', keyMessage: 'An illustration explains the idea', durationMs: 600, source: { kind: 'html', entry, seed: 7 } }] }
  return { dir, entry, story }
}
afterEach(async () => { await stopStoryJobs(); await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))) })

it('rejects unsupported/blocked claims, protocols, odd canvases and hidden capture intros', () => {
  const base = { schemaVersion: 1, id: 'test', title: 'Test', fps: 30, canvas: { width: 320, height: 180 }, scenes: [{ id: 'a', keyMessage: 'Test', durationMs: 1000, claimIds: ['c'], source: { kind: 'media', input: '/tmp/file.mp4', producer: 'fixture' } }], claims: [{ id: 'c', text: 'Proven', status: 'supported', evidence: [] }] }
  expect(storySchema.safeParse(base).success).toBe(false)
  expect(storySchema.safeParse({ ...base, claims: [{ ...base.claims[0], evidence: ['fixture'], status: 'blocked' }] }).success).toBe(false)
  expect(storySchema.safeParse({ ...base, claims: [], scenes: [{ ...base.scenes[0], claimIds: [], source: { kind: 'media', input: 'http://localhost/a', producer: 'test' } }] }).success).toBe(false)
  expect(storySchema.safeParse({ ...base, scenes: [{ ...base.scenes[0], source: { kind: 'capture', input: '/tmp/a', evidence: 'capture fixture', polish: { script: { title: 'Hidden shift', beats: [] } } } }] }).success).toBe(false)
})

describe.skipIf(!available)('encoded hybrid stories', () => {
  it('seeks out of order with stable pixels; blocks network and files outside the scene root', async () => {
    const { dir, entry } = await fixture()
    const options = { entry, width: 320, height: 180, fps: 10, frames: 6, seed: 9, frameDir: join(dir, 'seek') }
    const paths = await renderHtmlFrames({ ...options, sampleFrames: [2, 5, 2] })
    const expected = createHash('sha256').update(await readFile(paths[0])).digest('hex')
    const again = await renderHtmlFrames({ ...options, frameDir: join(dir, 'fresh'), sampleFrames: [2] })
    expect(createHash('sha256').update(await readFile(again[0])).digest('hex')).toBe(expected)
    await writeFile(entry, `<script>window.renderFrame=async()=>{let blocked=false;try{await fetch('https://example.com/')}catch{blocked=true}if(!blocked)throw Error('Network escaped');let r=await fetch('/outside.json').catch(()=>null);if(r?.ok)throw Error('Root escaped');document.body.style.background='red'}</script>`)
    await expect(renderHtmlFrames({ ...options, sampleFrames: [0] })).resolves.toHaveLength(1)
    const escape = join(dir, 'bad.html')
    await writeFile(escape, '<script>window.renderFrame=()=>{throw Error("fixture failed")}</script>')
    await expect(renderHtmlFrames({ ...options, entry: escape, sampleFrames: [0] })).rejects.toThrow('fixture failed')
  }, 30_000)

  it('renders generated-only and mixed stories with exact clocks, captions and review evidence', async () => {
    const { dir, story } = await fixture()
    const generated = await composeStory(story, join(dir, 'generated'))
    expect(generated.frames).toBe(6)
    expect((await getStoryStatus(join(dir, 'generated'))).status).toBe('completed')
    const recording = join(dir, 'recording.mp4')
    const voice = join(dir, 'voice.wav')
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=10:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', recording])
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.2', voice])
    const mixed: StoryInput = { ...story, scenes: [{ id: 'app', keyMessage: 'Fixture captured behavior', durationMs: 600, caption: 'Fixture capture', source: { kind: 'capture', input: recording, evidence: 'Synthetic recording fixture; no real product claim' } }, ...story.scenes], narration: [{ sceneId: 'idea', offsetMs: 100, text: 'An explanatory illustration', file: voice }] }
    const out = join(dir, 'mixed')
    const ack = await startStoryJob(await (async () => { const p = join(dir, 'story.json'); await writeFile(p, JSON.stringify(mixed)); return p })(), out)
    expect(ack.status).toBe('running')
    let status = ack
    for (let i = 0; i < 800 && status.status === 'running'; i++) { await new Promise(r => setTimeout(r, 50)); status = await getStoryStatus(out) }
    expect(status.status, status.error).toBe('completed')
    const result = status.result!
    const raw = JSON.parse(await runProcess('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', result.outPath]))
    const video = raw.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
    expect(Number(video.nb_read_frames)).toBe(12)
    expect(Number(video.width)).toBe(320)
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'))
    expect(manifest.scenes.map((s: { provenance: string }) => s.provenance)).toEqual(['captured', 'illustration'])
    expect(manifest.narration[0].startMs).toBe(700)
    expect(manifest.scenes[1].startFrame).toBe(6)
    expect(manifest.review.status).toBe('needs-review')
    expect(await readFile(result.captionsPath, 'utf8')).toContain('00:00:00,700 --> 00:00:00,900')
    expect(result.strips).toHaveLength(1)
    expect((await readFile(result.contactSheet)).subarray(1, 4).toString()).toBe('PNG')
    const pcm = join(dir, 'audio.f32')
    await ffmpeg(['-i', result.outPath, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', pcm])
    const samples = await readFile(pcm)
    const rms = (start: number, end: number) => { let sum=0,n=0; for(let i=start*48000; i<Math.min(end*48000,samples.length/4); i++){const v=samples.readFloatLE(i*4);sum+=v*v;n++}return Math.sqrt(sum/n) }
    expect(rms(0.1, 0.5)).toBeLessThan(0.001) // capture source tone is muted
    expect(rms(0.73, 0.85)).toBeGreaterThan(0.01)
    await expect(composeStory(story, out)).rejects.toThrow() // never overwrite
    const captureOnly = await composeStory({ ...mixed, scenes: [mixed.scenes[0]], narration: [] }, join(dir, 'capture'))
    expect(captureOnly.frames).toBe(6)
  }, 120_000)


  it('rejects short video hidden by longer audio, and cancels polishing', async () => {
    const { dir, story } = await fixture()
    const input = join(dir, 'short-picture.mp4')
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10:d=0.2', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input])
    await expect(composeStory({ ...story, scenes: [{ ...story.scenes[0], source: { kind: 'media', input, producer: 'short-video fixture' } }] }, join(dir, 'short'))).rejects.toThrow('shorter than scene')
    const controller = new AbortController(); controller.abort()
    await expect(polishScript({ input, outPath: join(dir, 'cancelled.mp4'), script: { beats: [] }, signal: controller.signal })).rejects.toThrow()
    const kept = await composeStory({ ...story, scenes: [{ ...story.scenes[0], durationMs: 200, source: { kind: 'capture', input, evidence: 'Fixture', keepAudio: true } }] }, join(dir, 'kept'))
    expect(kept.frames).toBe(2)
    const statusBefore = await readFile(join(dir, 'kept', 'status.json'), 'utf8')
    await getStoryStatus(join(dir, 'kept'))
    expect(await readFile(join(dir, 'kept', 'status.json'), 'utf8')).toBe(statusBefore)
  }, 30_000)

  it('serves local image assets but rejects symlink escapes', async () => {
    const { dir, entry } = await fixture()
    const [png] = await renderHtmlFrames({ entry, width: 320, height: 180, fps: 10, frames: 2, seed: 2, frameDir: join(dir, 'base'), sampleFrames: [0] })
    const asset = join(dir, 'image.png'); await writeFile(asset, await readFile(png))
    await writeFile(entry, '<img src="image.png"><script>window.renderFrame=()=>{}</script>')
    const options = { entry, width: 320, height: 180, fps: 10, frames: 2, seed: 2, frameDir: join(dir, 'assets'), sampleFrames: [0] }
    await expect(renderHtmlFrames(options)).resolves.toHaveLength(1)
    const outside = await mkdtemp(join(tmpdir(), 'spectra-story-outside-')); dirs.push(outside)
    const secret = join(outside, 'outside.png'); await writeFile(secret, await readFile(png))
    await symlink(secret, join(dir, 'escape.png'))
    await writeFile(entry, '<img src="escape.png"><script>window.renderFrame=()=>{}</script>')
    await expect(renderHtmlFrames(options)).rejects.toThrow()
  }, 30_000)

  it('rejects narration overrun before video rendering and persists failures', async () => {
    const { dir, story } = await fixture()
    const voice = join(dir, 'long.wav')
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=duration=1', voice])
    const out = join(dir, 'overrun')
    await expect(composeStory({ ...story, narration: [{ sceneId: 'idea', file: voice, text: 'Too long' }] }, out)).rejects.toThrow('overruns')
    expect((await getStoryStatus(out)).status).toBe('failed')
    expect(await readdir(out)).toEqual(expect.arrayContaining(['status.json', 'story.json']))
    expect(await readdir(out)).not.toContain('master.mp4')
    await writeFile(join(out, 'status.json'), JSON.stringify({ status: 'running', outDir: out }))
    expect((await getStoryStatus(out)).status).toBe('interrupted')
  }, 15_000)
})
