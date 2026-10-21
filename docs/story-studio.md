# Compose captured and generated video

Spectra can combine app recordings, authored HTML motion, and imported renders into one video. Capture still uses the real app. Generated scenes explain concepts or add openings and transitions. The same `spectra_demo` tool and `spectra demo` CLI work in Claude, Codex and other MCP/CLI agents.

Run `npm run build`, then `node examples/hybrid-story/render.mjs /absolute/new-output`. Append a recording path to insert a three-second real-app shot. The example is generated from source, requires FFmpeg and Chrome, and uses no credentials. The npm package ships `examples/` and this product document so the skill links also work after installation.

## Minimal story

```json
{
  "schemaVersion": 1,
  "id": "explanation",
  "title": "Explain one idea",
  "canvas": { "width": 1280, "height": 720 },
  "fps": 30,
  "scenes": [{
    "id": "idea",
    "keyMessage": "State the point this scene teaches",
    "durationMs": 4000,
    "source": { "kind": "html", "entry": "/absolute/scene/scene.html", "seed": 7, "props": { "heading": "One idea" } }
  }]
}
```

The authoritative parser is `src/pipeline/story-schema.ts` (built as `dist/pipeline/story-schema.js`). Unknown story fields reject rather than silently disappearing. Canvas dimensions are even, 64–4096 pixels; fps is 1–60; stories are at most 30 minutes. Each scene rounds its duration to an integer frame count once. Captions, narration, review frames and the manifest use those boundaries.

Other sources:

```json
{"kind":"capture","input":"/absolute/capture.mp4","startMs":0,"evidence":"Session / capture evidence locator","keepAudio":false}
{"kind":"media","input":"/absolute/render.mp4","startMs":0,"producer":"HyperFrames, Remotion or another renderer","sourcePath":"/absolute/original-project.json","keepAudio":false}
```

Inputs must be absolute regular local files. Video imports normalize fps and scale with letterboxing, never stretching. Use `media` for external generated videos; media imports are labeled illustrations. Stills and overlapping crossfades are not supported in version1. Animate a still in HTML or import an encoded render. Cuts preserve each scene's full allocation; smooth continuity comes from authored entry/exit motion.

A capture source may add `polish: {script: {beats: [...]}, style: "cool", spotlight: {...}}`. It reuses Spectra's framing, captions and zoom. Nested scripts reject `title` to prevent implicit intro timing shifts; use an explicit story opening. Each beat must fit its scene. The existing standalone `polish-clip` and `polish-script` actions also accept the existing `style`, `spotlight`, and `autoFocus` options through MCP/CLI.

`claims` reuse edit-plan claim records (`id`, `text`, `status`, `evidence`). Scenes refer to them using `claimIds`. Unknown, blocked, or evidence-free used claims reject. An evidence locator is an author-supplied basis, not independently verified product proof.

## Motion contract

```js
window.renderFrame = async (ms, {width, height, props}) => {
  // Assign the complete state from ms; never increment the old state.
  document.querySelector('h1').textContent = props.heading;
  document.querySelector('h1').style.opacity = String(Math.min(1, ms / 500));
};
```

Spectra seeks each frame explicitly and waits for the returned promise, fonts and images. CSS animations pause and seek to the same time. Date/performance use scene time; random resets from the scene seed and time. A zero→end→zero check rejects common stateful renderers, allowing at most one 8-bit color level of Chrome gradient dithering per channel. Authors must still avoid wall-clock timers, media playback and state accumulated across frames. Cross-machine font/browser differences can change pixels; bundle fonts and retain versions when exact reproduction matters.

HTML runs in an isolated temporary Chrome profile. A restricted HTTP server exposes supported asset types only within the scene's real directory; symlink escapes reject. CSP and request interception block outside requests, popups, workers and remote dependencies. Use a dedicated folder with only intended assets. Trusted authored content only: these restrictions are not a security boundary for hostile HTML. No user Chrome profile or account credentials are used.

## Voice and audio

Optional `narration` entries are `{sceneId, offsetMs, file, text}`. Every clip's measured duration must fit the assigned scene without overlapping another narration clip. Captions use those measured spans unless a scene sets `caption`. Supply intentional narration through your existing voice workflow; the composer neither chooses a TTS vendor nor changes Spectra's voice.

Optional `music` is an audio path; `sfx` is `[{atMs,file}]` on the master timeline. Existing Spectra mixing keeps audio pinned to video duration. Music ducks under SFX; music is not automatically ducked under voice, so pre-level it. Capture audio is muted by default. If narration exists it replaces source audio across the master; otherwise explicit `keepAudio` preserves it.

## Render and review

```sh
spectra demo '{"action":"compose","storyPath":"/absolute/story.json","outDir":"/absolute/new-output"}'
spectra demo '{"action":"compose-status","outDir":"/absolute/new-output"}'
```

`compose` is async-only over MCP/CLI and returns a job ID and `running` status after its snapshot/status are saved. Poll until `completed`, `failed` or `interrupted`. Outputs must use a new directory, so concurrent jobs cannot overwrite one another. Jobs do not auto-resume after daemon restart; poll marks unfinished jobs interrupted and an explicit retry uses a new directory. Graceful daemon shutdown cancels active rendering. Library callers can await `composeStory(story, outDir)` directly.

Completed outputs: `master.mp4` (H.264/AAC), `story.json`, `captions.srt`, `manifest.json`, `poster.png`, `reviews/contact-sheet.png`, and six-frame `reviews/cut-N.png` strips around each cut. Source hashes/provenance and measured narration remain in the manifest. Keep the original source directories: the story snapshot references inputs and does not copy the full asset tree.

Inspect encoded reviews and sound before sharing, repair the largest defects, and render a new version. Run `spectra scan-frames <master.mp4>` on captured content and resolve privacy findings. The manifest starts at `needs-review` with privacy scanning `not-run`: render completion proves media generation, not privacy approval, factual correctness or viewer comprehension.

Video-production requests and FFmpeg rendering have no fixed tool/encoding deadline (timeout `0`). Script/capture duration controls media length; explicit cancellation and process failures still stop work. MCP idle cleanup pauses while a forwarded request is active. Short control calls and individual browser health/seek operations retain their separate failure detection. A host can impose its own MCP deadline; async compose/status keeps long renders independent of that caller limit.
