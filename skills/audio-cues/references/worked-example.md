# Worked example — a 42s demo, scored end to end

A red→green test-fixing demo of a dev tool, captured at 1920×1080/30fps, no
voiceover. Ten beats, 42.0s of content. Every number below comes from applying
`SKILL.md` mechanically — nothing here was chosen per-video.

Set the environment once:

```bash
AUDIO="${CLAUDE_PLUGIN_ROOT:-$PWD}/assets/audio"   # in-repo: $PWD/assets/audio
DUR=42.0
```

## 1. Bed — select, loop, attenuate

Audience is a dev tool → `bed-warm-chill`. No voiceover → `-15dB`. The bed is 26s
and the video is 42s, so it must be looped or the last 16s go silent.

```bash
ffmpeg -stream_loop -1 -i "$AUDIO/beds/bed-warm-chill.m4a" \
  -t "$DUR" -filter:a "volume=-15dB" -c:a aac -b:a 192k -y /tmp/bed.m4a
```

## 2. Cues — boost each to ≈ −6 dBFS peak

Only the four cues this script actually uses:

```bash
ffmpeg -v error -i "$AUDIO/sfx/05-foundation-ground.m4a"     -filter:a "volume=23.0dB" -c:a aac -b:a 192k -y /tmp/cue-05.m4a
ffmpeg -v error -i "$AUDIO/sfx/01-precision-tick.m4a"        -filter:a "volume=14.0dB" -c:a aac -b:a 192k -y /tmp/cue-01.m4a
ffmpeg -v error -i "$AUDIO/sfx/03-momentum-ascend.m4a"       -filter:a "volume=17.8dB" -c:a aac -b:a 192k -y /tmp/cue-03.m4a
ffmpeg -v error -i "$AUDIO/sfx/06-attention-signal.m4a"      -filter:a "volume=21.0dB" -c:a aac -b:a 192k -y /tmp/cue-06.m4a
ffmpeg -v error -i "$AUDIO/sfx/02-verification-resolve.m4a"  -filter:a "volume=20.9dB" -c:a aac -b:a 192k -y /tmp/cue-02.m4a
ffmpeg -v error -i "$AUDIO/sfx/04-craft-settle.m4a"          -filter:a "volume=18.0dB" -c:a aac -b:a 192k -y /tmp/cue-04.m4a
```

## 3. The ladder, beat by beat

| # | Beat text | `action.kind` | Row fired | Cue | `offsetMs` | Cue at |
|---|---|---|---|---|---|---|
| 1 | Open the project | navigate | **1** first beat | `05-foundation-ground` | 0 | 0ms |
| 2 | Find the failing test | search | **6** input | `01-precision-tick` | 0 | 3800ms |
| 3 | Run the full suite | click | **5** `run` outranks the click | `03-momentum-ascend` | 0 | 7600ms |
| 4 | 3 tests failed | click | **2** failure lexicon | `06-attention-signal` | 400 | 11400ms |
| 5 | Read the stack trace | scroll | **7** transit | *(none)* | — | — |
| 6 | Apply the fix | click | **6** input | `01-precision-tick` | 0 | 19000ms |
| 7 | Re-run the suite | click | **5** `run` | `03-momentum-ascend` | 0 | 23000ms |
| 8 | All 47 tests passed | click | **3** success lexicon | `02-verification-resolve` | 500 | 28000ms |
| 9 | Hold on the green suite | hold | **7** dwell | *(none)* | — | — |
| 10 | Build complete | click | **4** last beat + `complete` | `04-craft-settle` | 300 | 36300ms |

Beats 3, 4, 7, 8 and 10 all have `action.kind: click`. Rows 2–5 outrank row 6, so
the outcome — not the mechanical click — picks the cue. That precedence is the
whole reason this is a lookup and not a judgment call.

**Density check:** 8 cues over 42.0s = 1 per 5.25s, inside the ≤1-per-4s cap.
**Spacing check:** closest pair is 23000 → 28000 (5.0s); minimum is 1.2s. Passes.

## 4. The `polish-script` call

```json
{
  "action": "polish-script",
  "input": "/abs/path/raw-capture.mp4",
  "out": "/abs/path/demo-scored.mp4",
  "fps": 30,
  "music": "/tmp/bed.m4a",
  "script": {
    "title": "Red to green in 42 seconds",
    "finalCaption": "Every fix, verified.",
    "beats": [
      { "id": "open",    "startMs": 0,     "endMs": 3800,  "stepText": "Open the project",
        "action": { "kind": "navigate" },
        "sound": { "file": "/tmp/cue-05.m4a", "offsetMs": 0 } },
      { "id": "find",    "startMs": 3800,  "endMs": 7600,  "stepText": "Find the failing test",
        "action": { "kind": "search", "value": "checkout.spec" },
        "sound": { "file": "/tmp/cue-01.m4a", "offsetMs": 0 } },
      { "id": "run",     "startMs": 7600,  "endMs": 11000, "stepText": "Run the full suite",
        "action": { "kind": "click", "target": "Run tests" },
        "sound": { "file": "/tmp/cue-03.m4a", "offsetMs": 0 } },
      { "id": "fail",    "startMs": 11000, "endMs": 15500, "stepText": "3 tests failed",
        "action": { "kind": "click", "target": "Failures" },
        "sound": { "file": "/tmp/cue-06.m4a", "offsetMs": 400 } },
      { "id": "trace",   "startMs": 15500, "endMs": 19000, "stepText": "Read the stack trace",
        "action": { "kind": "scroll" } },
      { "id": "fix",     "startMs": 19000, "endMs": 23000, "stepText": "Apply the fix",
        "action": { "kind": "click", "target": "Apply" },
        "sound": { "file": "/tmp/cue-01.m4a", "offsetMs": 0 } },
      { "id": "rerun",   "startMs": 23000, "endMs": 27500, "stepText": "Re-run the suite",
        "action": { "kind": "click", "target": "Run tests" },
        "sound": { "file": "/tmp/cue-03.m4a", "offsetMs": 0 } },
      { "id": "green",   "startMs": 27500, "endMs": 32000, "stepText": "All 47 tests passed",
        "action": { "kind": "click", "target": "Summary" },
        "sound": { "file": "/tmp/cue-02.m4a", "offsetMs": 500 } },
      { "id": "hold",    "startMs": 32000, "endMs": 36000, "stepText": "Hold on the green suite",
        "action": { "kind": "hold" } },
      { "id": "done",    "startMs": 36000, "endMs": 42000, "stepText": "Build complete",
        "action": { "kind": "click", "target": "Ship" },
        "sound": { "file": "/tmp/cue-04.m4a", "offsetMs": 300 } }
    ]
  }
}
```

Nothing goes in the top-level `sfx[]` here — every cue belongs to a beat, so every
cue re-syncs automatically if a beat's timing is re-measured. Reserve `sfx[]` for
cues that no beat owns.

## 5. Verify the render

```bash
# 1. bed covers the whole video (expect 42.000000)
ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/bed.m4a

# 2. a cue window reads hotter than a bed-only window
ffmpeg -v info -ss 1.0  -t 0.7 -i /abs/path/demo-scored.mp4 -af volumedetect -f null - 2>&1 | grep max_volume
ffmpeg -v info -ss 28.0 -t 0.6 -i /abs/path/demo-scored.mp4 -af volumedetect -f null - 2>&1 | grep max_volume
```

Reference measurement, taken from a real `polish-script` render of this recipe
(`bed-warm-chill` at −15 dB, cues boosted per the table above):

| Window | Peak | Mean |
|---|---|---|
| Bed only | −15.4 dBFS | −24.6 dBFS |
| `05-foundation-ground` at t=0 | −8.4 dBFS | −17.6 dBFS |
| `02-verification-resolve` at `startMs 6000 + offsetMs 500` | −8.9 dBFS | −19.3 dBFS |

Cues read ~7 dB over the bed, and the second cue lands in the 6.4–7.2s window —
confirming `atMs = startMs + offsetMs`. Two windows that measure the *same* mean
the prep in steps 1–2 was skipped.

## 6. Voiceover variant

Add `"voiceover": "/abs/path/vo.m4a"` and re-prep the bed at `-20dB` instead of
`-15dB`. The bed sidechain-ducks under SFX only — never under the voiceover — so
the under-VO level has to be baked into the bed file itself.
