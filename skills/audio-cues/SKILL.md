---
name: audio-cues
description: >
  Use when a Spectra video needs sound — "add music to this demo", "add sound
  effects", "which sound cue goes here", "sync sound to the beats", "the music is
  too loud / the cue is inaudible", "duck the music", "what audio can I legally
  use", or whenever a `polish-script` render is being assembled with `music`,
  `sfx`, or per-beat `sound`. Maps each demo-script beat to a specific cue file
  from `assets/audio/`, sets the bed/cue prep levels the pipeline does NOT apply
  for you, and enforces the no-copyrighted-audio rule.
user-invocable: true
---

# Audio Cues (beat → cue, deterministically)

The AUDIO companion to `video-design` (craft theory) and `demo` (render mechanics).
`video-design/references/sound.md` decides music *character* and VO levels; this
skill decides **which cue file fires on which beat**, and at **what level**, so no
video needs a hand-built cue map.

## The two rules that govern everything

1. **Cue choice is a lookup, not a creative decision.** Run the beat down the
   ladder below; first match wins; unmatched beats stay silent.
2. **Prep both layers before rendering.** `polish-script` applies **no gain** to
   `music` or `sfx` — it mixes the files exactly as given. The catalogue beds peak
   at 0 dBFS and the cues peak at −20 to −29 dBFS, so handing raw files to the
   pipeline buries every cue under the music. Prep is mandatory, not polish.

Measured on `bed-warm-chill` + `02-verification-resolve` through the pipeline's own
filter graph:

| Path | Bed-only level | Cue-window level | Result |
|---|---|---|---|
| Raw catalogue files | −0.8 dBFS | −0.8 dBFS | Cue inaudible; music at full scale over the content |
| Prepped (below) | −15.8 dBFS | −8.8 dBFS | Cue reads +7 dB over the bed; bed ducks 18.6 dB under it |

## Asset paths

The catalogue is `assets/audio/` — `beds/` (4 music beds), `sfx/` (6 per-beat
cues), `alerts/` (app tones, **not** render inputs), and `manifest.json` (tagged
index). Resolve it as `${CLAUDE_PLUGIN_ROOT}/assets/audio` when Spectra is
installed as a plugin, or repo-relative when working in the Spectra repo. **Always
pass absolute paths** to `polish-script` — ffmpeg resolves them against the daemon's
cwd, not yours.

## Step 1 — prep the bed (loop + attenuate, one command)

Beds are 24–26s static loops at full scale. A longer video gets silence after the
bed ends, because the pipeline does not loop `music`.

```bash
ffmpeg -stream_loop -1 -i "$AUDIO/beds/bed-warm-chill.m4a" \
  -t "$VIDEO_DURATION_SEC" -filter:a "volume=-15dB" \
  -c:a aac -b:a 192k -y /tmp/bed-prepped.m4a
```

- `-15dB` when the video has **no voiceover** (bed lands ≈ −24 dBFS mean).
- `-20dB` when a **voiceover** is present — the pipeline ducks the bed under *SFX
  only*, never under VO, so the under-VO level must be baked in here
  (`video-design/references/sound.md`: music −15 to −20 dBFS under VO).

## Step 2 — prep each cue (boost to ≈ −6 dBFS peak)

```bash
# measure, then boost by (-6 - max_volume)
ffmpeg -v info -i "$AUDIO/sfx/02-verification-resolve.m4a" -af volumedetect -f null - 2>&1 | grep max_volume
ffmpeg -v error -i "$AUDIO/sfx/02-verification-resolve.m4a" -filter:a "volume=20.9dB" \
  -c:a aac -b:a 192k -y /tmp/cue-02.m4a
```

Catalogue peaks (so you can compute the boost without measuring):

| Cue | Peak | Boost to −6 dBFS | Length |
|---|---|---|---|
| `01-precision-tick` | −20.0 | +14.0 dB | 0.10s |
| `02-verification-resolve` | −26.9 | +20.9 dB | 0.53s |
| `03-momentum-ascend` | −23.8 | +17.8 dB | 0.59s |
| `04-craft-settle` | −24.0 | +18.0 dB | 1.06s |
| `05-foundation-ground` | −29.0 | +23.0 dB | 1.17s |
| `06-attention-signal` | −27.0 | +21.0 dB | 0.62s |

A cue at −6 dBFS peak sits 28 dB over the pipeline's sidechain threshold (0.02 ≈
−34 dBFS, ratio 8), which is what makes the automatic duck actually engage.

## Step 3 — the beat → cue ladder (first match wins)

Evaluate each beat top-down. Match against `stepLabel` + `stepText` (case-insensitive)
and `action.kind`.

| # | Beat signal | Cue | Why |
|---|---|---|---|
| 1 | **First beat of the script** | `05-foundation-ground` | Session start / the stack comes up |
| 2 | Text matches `error\|fail\|blocked\|denied\|missing\|warning\|needs you` | `06-attention-signal` | Signal, not alarm |
| 3 | Text matches `pass\|passed\|green\|verified\|success\|confirmed\|✓\|works` | `02-verification-resolve` | Ground truth landed |
| 4 | **Last beat**, or text matches `done\|complete\|shipped\|built\|merged\|finished` | `04-craft-settle` | The iteration lands |
| 5 | `action.kind == navigate`, or text matches `run\|start\|launch\|dispatch\|generat` | `03-momentum-ascend` | Work was kicked off |
| 6 | `action.kind` ∈ `search`, `click` | `01-precision-tick` | Keystroke / confirm |
| 7 | `action.kind` ∈ `scroll`, `hold`, or no action | *(no cue)* | Transit and dwell stay silent |

Failure and success outcomes outrank the mechanical action that produced them —
that is why rows 2–4 sit above rows 5–6. A beat whose text says "tests passed" gets
the verification cue even though its action was a click.

### Density and spacing (mechanical, not taste)

- **One cue per beat, maximum.** Never stack cues on a single beat.
- **≥1.2s between consecutive cue starts.** The longest cue is 1.17s; closer
  spacing overlaps two cues into mud. On a conflict, keep the higher-priority
  ladder row and drop the other.
- **Transit stays silent.** Row 7 keeps scroll, hold, and action-less beats quiet.
- **≤1 cue per 4s of runtime** (≈15/min — the top of the product-demo cut-rate band
  in `video-design/references/pacing.md`). If the ladder produces more, the script
  is over-segmented: merge beats rather than deleting cues.

## Step 4 — attach the cues

Prefer the per-beat `sound` field. It travels with the script and re-syncs
automatically when a beat moves; `atMs` is computed as `beat.startMs + offsetMs`.

```json
{ "id": "run-tests", "startMs": 8200, "endMs": 12000,
  "stepText": "All 47 tests passed",
  "sound": { "file": "/abs/path/cue-02.m4a", "offsetMs": 400 } }
```

Set `offsetMs` to the delay between the beat's first frame and the frame where the
change becomes *visible* (0 for input beats; measure it for outcome beats — the
result appears after the action completes). Use top-level `sfx[]` only for cues not
owned by a beat. Both lists merge; an intro title card shifts beat cues and the base
track but not the music bed.

## Bed selection

| Product / audience | Bed | Energy |
|---|---|---|
| AI agent, dev tool, macOS productivity | `bed-warm-chill` | low |
| Enterprise B2B, feature/momentum sequence, Product Hunt launch | `bed-driving-electro` | high |
| Consumer iOS, lifestyle | `bed-funk` | medium |
| Hip-hop / R&B segment | `bed-hiphop-rnb` | medium |

Cross-check the character against `video-design/references/sound.md` (BPM by
audience) before overriding.

## Ducking — what the pipeline does and does not do

- **Automatic:** the combined SFX stream sidechain-ducks the music bed
  (`threshold=0.02 ratio=8 attack=5 release=250`). Measured depth with prepped
  layers: **−18.6 dB mean** under a cue, recovering over ~250ms. No knobs are
  exposed — do not try to configure it.
- **Not automatic:** bed level under voiceover (bake it into Step 1), the extra
  3–6 dB dip under heavy on-screen text (pre-render a second, quieter bed segment
  if a section needs it), and any cue-level balancing (attenuate the individual cue
  file, never the mix).

## No copyrighted audio — non-negotiable

- **Use `assets/audio/` only.** Beds are rendered from GarageBand Apple Loops
  (royalty-free for use in your own productions); cues and alerts are original
  ffmpeg synthesis. Nothing else in the tree is cleared.
- **Never** commercial, chart, or trending music; never audio ripped from a
  platform's creator library; never a "royalty-free" download whose license you
  cannot point at on disk. A bed from outside the catalogue ships only with its
  license file recorded alongside it — otherwise decline and use a catalogue bed.
- **Pre-strip the capture's own audio.** Both `polish-clip` and `polish-script`
  **preserve** a source audio track when the input has one — `polish-script` mixes
  it under the bed and cues as the base layer unless a `voiceover` replaces it.
  A dev-session recording may carry voices, notifications, or customer data, so
  strip it before rendering unless that audio is deliberately part of the
  deliverable and cleared:

  ```bash
  ffmpeg -v error -i raw-capture.mp4 -c:v copy -an -y raw-capture-silent.mp4
  ```
- `alerts/` are host-app event tones (Easy Terminal status events). They are not
  render inputs — do not reach for them as SFX cues.

## Verify before shipping

```bash
# bed reaches the end of the video
ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/bed-prepped.m4a
# every cue is audible over the bed: cue windows should read ~6-10 dB hotter
ffmpeg -v info -ss <cue_t> -t 0.6 -i out.mp4 -af volumedetect -f null - 2>&1 | grep max_volume
```

A cue window that measures the same as its neighbouring bed-only window means the
prep was skipped — go back to Step 2.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Cues inaudible | Raw cue files passed through | Step 2 boost |
| Music drowns the demo | Raw bed passed through (peaks 0 dBFS) | Step 1 `volume=-15dB` |
| Music stops partway | Bed is 24–26s; pipeline does not loop `music` | Step 1 `-stream_loop -1 -t <duration>` |
| Two cues smear together | Cue starts <1.2s apart | Drop the lower-priority ladder match |
| Cue lands before the visible change | `offsetMs` left at 0 on an outcome beat | Measure the delay, set `offsetMs` |
| Bed never ducks | Cues too quiet to cross the −34 dBFS sidechain threshold | Step 2 boost |

## References

- `references/worked-example.md` — a complete 42s script with the ladder applied
  beat-by-beat, prep commands, and the full `spectra_demo` call.
- `assets/audio/manifest.json` — tagged asset index (id, role, energy, duration,
  source, licensing).
- `../video-design/references/sound.md` — music BPM by audience, VO levels, silence.
- `../video-design/references/pacing.md` — beat/cut rate, pattern interrupts.
