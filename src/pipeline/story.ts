import { createReadStream } from 'node:fs'
import { readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { compileEditPlan } from '../media/edit-plan.js'
import { buildMixedAudioArgs, polishScript } from './polish.js'
import { storySchema, storyTimeline, localPathSchema, type Story, type StoryInput } from './story-schema.js'
import { renderHtmlFrames } from './html-render.js'
import { storyReviews } from './story-review.js'
import { ffmpeg, probe, regularFile, runProcess } from './story-process.js'

export interface StoryResult {
  outPath: string; manifestPath: string; captionsPath: string; contactSheet: string;
  poster: string; strips: string[]; width: number; height: number; fps: number; frames: number; durationMs: number
}
export interface StoryStatus {
  ownerPid: number; jobId: string; status: 'running' | 'completed' | 'failed' | 'interrupted'; outDir: string;
  completedScenes: number; totalScenes: number; startedAt: string; result?: StoryResult; error?: string
}
const jobs = new Map<string, { controller: AbortController; task: Promise<StoryResult> }>()
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
async function saveStatus(status: StoryStatus) {
  const path = join(status.outDir, 'status.json')
  await writeFile(path + '.tmp', JSON.stringify(status, null, 2))
  await rename(path + '.tmp', path)
}
export async function getStoryStatus(outDir: string): Promise<StoryStatus> {
  localPathSchema.parse(outDir)
  const status = JSON.parse(await readFile(join(outDir, 'status.json'), 'utf8')) as StoryStatus
  if (status.status === 'running' && !jobs.has(resolve(outDir))) {
    // Reads must never rewrite a live owner's status or race its terminal write.
    let ownerAlive = Number.isInteger(status.ownerPid) && status.ownerPid > 0
    if (ownerAlive) {
      try { process.kill(status.ownerPid, 0) } catch (error) { ownerAlive = (error as NodeJS.ErrnoException).code !== 'ESRCH' }
    }
    if (!ownerAlive) return { ...status, status: 'interrupted', error: 'Renderer owner stopped. Retry with a new output directory; jobs do not auto-resume.' }
  }
  return status
}
export async function stopStoryJobs(): Promise<void> {
  const active = [...jobs.values()]
  for (const job of active) job.controller.abort(new Error('Spectra is shutting down'))
  await Promise.allSettled(active.map(job => job.task))
}

/** Returns after the editable input and running status are durable, before rendering. */
export async function startStoryJob(storyPath: string, outDir: string): Promise<StoryStatus> {
  const story = storySchema.parse(JSON.parse(await readFile(await regularFile(storyPath), 'utf8')))
  const { status, task } = await beginStory(story, outDir)
  void task.catch(() => {}) // terminal failure is persisted for the caller to poll
  return status
}
export async function composeStory(input: StoryInput, outDir: string): Promise<StoryResult> {
  const { task } = await beginStory(storySchema.parse(input), outDir)
  return task
}
async function beginStory(story: Story, outDir: string) {
  localPathSchema.parse(outDir)
  outDir = resolve(outDir)
  // Exclusive directory creation is the job lock. Never overwrite an earlier output.
  await mkdir(dirname(outDir), { recursive: true })
  await mkdir(outDir)
  const status: StoryStatus = { ownerPid: process.pid, jobId: randomUUID(), status: 'running', outDir, completedScenes: 0, totalScenes: story.scenes.length, startedAt: new Date().toISOString() }
  await writeFile(join(outDir, 'story.json'), JSON.stringify(story, null, 2))
  await saveStatus(status)
  const controller = new AbortController()
  const task = Promise.resolve().then(async () => {
    try {
      const result = await renderStory(story, outDir, controller.signal, async completed => {
        status.completedScenes = completed; await saveStatus(status)
      })
      status.status = 'completed'; status.result = result; await saveStatus(status)
      return result
    } catch (error) {
      status.status = 'failed'; status.error = (error as Error).message
      // Partial movies/reviews must never look like a completed export.
      await Promise.all(['master.mp4', 'poster.png', 'reviews', 'manifest.json', 'captions.srt'].map(p => rm(join(outDir, p), { recursive: true, force: true })))
      await saveStatus(status)
      throw error
    } finally { jobs.delete(outDir) }
  })
  jobs.set(outDir, { controller, task })
  return { status: { ...status }, task }
}

async function renderStory(story: Story, outDir: string, signal: AbortSignal, progress: (done: number) => Promise<void>): Promise<StoryResult> {
  const temp = await mkdtemp(join(tmpdir(), 'spectra-story-'))
  try {
    const timeline = storyTimeline(story)
    const frames = timeline.at(-1)!.startFrame + timeline.at(-1)!.frames
    const duration = frames / story.fps
    const { width, height } = story.canvas
    const sourceHashes = new Map<string, string>()
    const measureFile = async (file: string) => {
      await regularFile(file)
      if (!sourceHashes.has(file)) {
        const digest = createHash('sha256')
        for await (const chunk of createReadStream(file)) digest.update(chunk)
        sourceHashes.set(file, digest.digest('hex'))
      }
    }
    // Validate and measure every audio clip before spending time on video rendering.
    const narration = [] as Array<{ sceneId: string; file: string; text: string; startMs: number; durationMs: number }>
    for (const n of story.narration) {
      await measureFile(n.file)
      const media = await probe(n.file, signal)
      if (!media.audio) throw new Error(`Narration has no audio: ${n.file}`)
      const scene = timeline.find(s => s.id === n.sceneId)!
      const lengthMs = Math.ceil(media.duration * 1000)
      if (n.offsetMs + lengthMs > scene.frames * 1000 / story.fps + 1) throw new Error(`Narration overruns scene: ${n.sceneId}`)
      narration.push({ sceneId: n.sceneId, file: n.file, text: n.text, startMs: scene.startMs + n.offsetMs, durationMs: lengthMs })
    }
    narration.sort((a, b) => a.startMs - b.startMs)
    for (let i = 1; i < narration.length; i++) if (narration[i].startMs < narration[i - 1].startMs + narration[i - 1].durationMs) throw new Error('Narration clips overlap')
    for (const file of [story.music, ...story.sfx.map(s => s.file)].filter((f): f is string => !!f)) {
      await measureFile(file)
      if (!(await probe(file, signal)).audio) throw new Error(`Audio input has no audio stream: ${file}`)
    }
    // Preflight all source files before producing a partial sequence.
    const mediaInfo = new Map<string, Awaited<ReturnType<typeof probe>>>()
    for (const scene of timeline) {
      const source = scene.source
      if (source.kind === 'html') { await measureFile(source.entry); continue }
      await measureFile(source.input)
      if (source.kind === 'media' && source.sourcePath) await measureFile(source.sourcePath)
      const info = await probe(source.input, signal)
      if (!info.width) throw new Error(`Scene requires a video: ${scene.id}`)
      if (source.startMs / 1000 + scene.frames / story.fps > info.videoDuration + 0.001) throw new Error(`Source is shorter than scene: ${scene.id}`)
      mediaInfo.set(scene.id, info)
    }
    const clips: string[] = []
    const manifestScenes = []
    for (const [i, scene] of timeline.entries()) {
      signal.throwIfAborted()
      const clip = join(temp, `scene-${i}.mp4`)
      const source = scene.source
      let input: string, start = 0, hasAudio = false
      let info = mediaInfo.get(scene.id)
      if (source.kind === 'html') {
        const frameDir = join(temp, `frames-${i}`)
        await renderHtmlFrames({ entry: source.entry, seed: source.seed, props: source.props, ...story.canvas, fps: story.fps, frames: scene.frames, frameDir, signal })
        input = join(frameDir, '%06d.png')
      } else {
        input = source.input; start = source.startMs / 1000; hasAudio = source.keepAudio && info!.audio
        if (source.kind === 'capture' && source.polish) {
          // Trim before polish so its beat clock starts at this scene's zero.
          const raw = join(temp, `raw-${i}.mp4`)
          await ffmpeg(['-ss', String(start), '-i', input, '-t', String(scene.frames / story.fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(hasAudio ? ['-c:a', 'aac'] : ['-an']), raw], signal)
          input = join(temp, `polish-${i}.mp4`)
          await polishScript({ input: raw, outPath: input, script: source.polish.script, style: source.polish.style, spotlight: source.polish.spotlight, fps: story.fps, signal })
          signal.throwIfAborted()
          start = 0; info = await probe(input, signal)
        }
      }
      const inputs = source.kind === 'html'
        ? ['-framerate', String(story.fps), '-i', input]
        : ['-ss', String(start), '-protocol_whitelist', 'file,pipe', '-i', input]
      if (!hasAudio) inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
      await ffmpeg([...inputs, '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0',
        '-vf', `fps=${story.fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
        '-frames:v', String(scene.frames), '-t', String(scene.frames / story.fps), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-af', `apad,atrim=end=${scene.frames / story.fps}`, clip], signal)
      clips.push(clip)
      manifestScenes.push({ id: scene.id, keyMessage: scene.keyMessage, claimIds: scene.claimIds, startFrame: scene.startFrame, frames: scene.frames,
        startMs: scene.startMs, endMs: scene.endMs, source, sourceSha256: sourceHashes.get(source.kind === 'html' ? source.entry : source.input),
        provenance: source.kind === 'capture' ? 'captured' : 'illustration',
        letterboxed: info ? info.width * height !== info.height * width : false })
      await progress(i + 1)
    }
    const silentMaster = join(temp, 'assembled.mp4')
    const prepared = timeline.map((s, i) => `[${i}:v]trim=end_frame=${s.frames},setpts=PTS-STARTPTS[v${i}];[${i}:a]atrim=end=${s.frames / story.fps},asetpts=PTS-STARTPTS[a${i}]`).join(';')
    const concat = prepared + ';' + clips.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${clips.length}:v=1:a=1[v][a]`
    await ffmpeg([...clips.flatMap(p => ['-i', p]), '-filter_complex', concat, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-r', String(story.fps), '-frames:v', String(frames), '-t', String(duration), silentMaster], signal)
    let voiceover: string | undefined
    if (narration.length) {
      voiceover = join(temp, 'narration.m4a')
      const chains = narration.map((n, i) => `[${i}:a]adelay=${n.startMs}:all=1[n${i}]`)
      chains.push(narration.map((_, i) => `[n${i}]`).join('') + `amix=inputs=${narration.length}:normalize=0,apad,atrim=end=${duration}[voice]`)
      await ffmpeg([...narration.flatMap(n => ['-i', n.file]), '-filter_complex', chains.join(';'), '-map', '[voice]', '-c:a', 'aac', voiceover], signal)
    }
    const master = join(outDir, 'master.mp4')
    const inputs = ['-i', silentMaster, ...(voiceover ? ['-i', voiceover] : [])]
    const mix = buildMixedAudioArgs({ base: voiceover ? { kind: 'voiceover', inputIndex: 1 } : { kind: 'source' }, nextInputIndex: voiceover ? 2 : 1, videoDurationSec: duration, music: story.music, sfx: story.sfx })
    await ffmpeg([...inputs, ...mix.inputArgs, '-filter_complex', mix.filter, '-map', '0:v:0', ...mix.mapArgs, '-c:v', 'copy', ...mix.codecArgs, '-movflags', '+faststart', master], signal)
    const encoded = JSON.parse(await runProcess('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', master], signal)) as { streams: Array<{ codec_type: string; nb_read_frames: string }> }
    const encodedFrames = Number(encoded.streams.find(s => s.codec_type === 'video')?.nb_read_frames)
    if (encodedFrames !== frames) throw new Error(`Encoded frame count ${encodedFrames} differs from story allocation ${frames}`)
    // SRT uses the same edit-plan compiler as the narrative planning library.
    const compiled = compileEditPlan({ ...story, beats: timeline.map(s => ({ id: s.id, startMs: s.startMs, endMs: s.endMs, keyMessage: s.keyMessage, claimIds: s.claimIds, caption: s.caption })) })
    const captionsPath = join(outDir, 'captions.srt')
    // Narration subtitles use measured sentence spans; explicit scene captions override them.
    const cues = timeline.flatMap(s => s.caption ? [{ id: s.id, startMs: s.startMs, endMs: s.endMs, keyMessage: s.keyMessage, caption: s.caption }] : narration.filter(n => n.sceneId === s.id).map((n, i) => ({ id: `${s.id}-${i}`, startMs: n.startMs, endMs: n.startMs + n.durationMs, keyMessage: s.keyMessage, caption: n.text })))
    const captions = cues.length ? compileEditPlan({ ...story, claims: [], beats: cues }).captionsSrt : compiled.captionsSrt
    await writeFile(captionsPath, captions)
    const reviews = await storyReviews(master, outDir, temp, story.fps, timeline, signal)
    const manifestPath = join(outDir, 'manifest.json')
    const result: StoryResult = { outPath: master, manifestPath, captionsPath, ...reviews, width, height, fps: story.fps, frames, durationMs: frames * 1000 / story.fps }
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, storyId: story.id, title: story.title, storySha256: hash(JSON.stringify(story)), ...result,
      scenes: manifestScenes, claims: story.claims, narration, inputHashes: Object.fromEntries(sourceHashes),
      review: { status: 'needs-review', privacyScan: 'not-run', note: 'Inspect contact sheet, cut strips, captions and capture privacy before sharing. Illustration is not proof of live app behavior.' },
      audioPolicy: 'Source audio muted unless keepAudio; narration replaces source audio; music and SFX mix on master time. Pre-level music beneath voice.' }, null, 2))
    return result
  } finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }) }
}
