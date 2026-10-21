// npm run build; node examples/hybrid-story/render.mjs /absolute/NEW-output-dir [captured.mp4]
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { composeStory } from '../../dist/pipeline/story.js'
const out = process.argv[2]
if (!out) throw new Error('Pass a new output directory; optionally pass a real capture to insert.')
const entry = fileURLToPath(new URL('scene.html', import.meta.url))
const card = (id, label, heading, body, durationMs) => ({ id, keyMessage: heading, durationMs,
  source: { kind: 'html', entry, seed: 7, props: { label, heading, body, durationMs } } })
const scenes = [card('opening', 'Spectra story studio', 'One clear idea.', 'Build an explanation around the point your viewer should remember.', 3500)]
if (process.argv[3]) scenes.push({ id: 'product', keyMessage: 'Show the actual product', durationMs: 3000,
  source: { kind: 'capture', input: resolve(process.argv[3]), evidence: 'User-supplied real app recording; review before sharing.' } })
scenes.push(card('explain', 'Explain with motion', 'Make the invisible visible.', 'Use generated scenes for concepts, context and transitions between real app shots.', 4000))
scenes.push(card('closing', 'Keep the evidence', 'Show. Explain. Verify.', 'Review the encoded frames and keep every claim connected to its source.', 3500))
const result = await composeStory({ schemaVersion: 1, id: 'one-clear-idea', title: 'One clear idea', canvas: { width: 1280, height: 720 }, fps: 30, scenes }, resolve(out))
console.log(JSON.stringify(result, null, 2))
