---
name: demo
description: Use when the user asks to produce a polished demo video from a screen recording, highlight key moments in a recording, add spotlight focus to video segments, create an agent demo video, or trim and caption a screen capture for sharing.
version: 0.1.0
user-invocable: true
---

# Agent Demo Video Production

Transforms raw screen recordings into polished, shareable demo clips. Applies a spotlight focus effect (sharp focal region, blurred and dimmed background), adds optional lower-third captions, and merges multiple segments into one mp4. Audio is always stripped — screen recordings of dev sessions may contain sensitive audio.

## Privacy and Integrity Rules

Before producing a demo from any recording:

- **Strip audio always.** The tool does this automatically (-an). Never re-add audio from a recording session.
- **Frame-scan for secrets.** Review captured frames with `spectra_capture mode=auto` or a frame-by-frame read before sharing. Look for API keys, tokens, passwords, hostnames, and internal URLs in terminal output or browser developer tools.
- **Real footage only.** The on-camera work must be a real run, never a replayed or scripted sequence presented as live. Staging is fine for setup; what runs on camera is real.
- **Keep artifacts local.** Outputs go into `.spectra/` or a user-specified path. Never move demo artifacts into `artifacts/` (the library) or any public-facing directory without an explicit review step.

## Workflow

### Step 1 — Scan for active stretches

```
spectra_demo action=scan input=/path/to/recording.mp4
```

Returns:
- `perMinute` — scene-change count per minute (identify the busiest 2-3 minutes)
- `activeRanges` — contiguous stretches of activity (gap-merged with 5s tolerance)

Use the returned ranges to identify which segments are worth including. Prefer segments where the agent is visibly doing work — not idle pauses, loading screens, or terminal waiting states.

### Step 2 — Read key frames to pick segments

For each candidate active range, use `spectra_capture` or a frame read to see what's actually on screen at that point. Make a judgment call:

- Is the content comprehensible to an outside viewer?
- Does it show a distinct beat (action → result, not mid-action blur)?
- Is anything sensitive visible (key material, internal hostnames, passwords)?

Write one caption per beat — present-tense, outcome-focused. "Claude Code routes the task to codex" not "Task routing occurring".

### Step 3 — Polish and merge

```
spectra_demo action=polish spec={
  canvas: { w: 1920, h: 1080 },
  segments: [
    {
      input: "/path/to/recording.mp4",
      startSec: 45,
      durationSec: 12,
      focal: { x: 200, y: 100, w: 1520, h: 800 },
      caption: "Build-loop hands triage to codex via Rally Point"
    },
    {
      input: "/path/to/recording.mp4",
      startSec: 120,
      durationSec: 8,
      focal: { x: 200, y: 100, w: 1520, h: 800 },
      caption: "codex responds with a targeted fix in 4 seconds"
    }
  ],
  speed: 1.2
} out=/path/to/demo-output.mp4
```

Returns: `{ out, segmentCount, warnings }`. Check `warnings` for caption fallbacks or skipped captions.

## Focal Region Selection

The focal rect (`x, y, w, h`) should frame the most important content on screen — the terminal output, the specific UI element, the rally message — not the full display. Tight framing creates sharper contrast between the spotlight and the blurred background.

For a typical 1920x1080 display:
- Full terminal pane (left half): `{ x: 0, y: 0, w: 960, h: 1080 }`
- Browser pane (right half): `{ x: 960, y: 0, w: 960, h: 1080 }`
- Terminal output region (centered): `{ x: 80, y: 200, w: 1760, h: 600 }`

For a side-by-side composite recording (from spectra_capture composite mode), each pane is typically 960px wide.

## Caption Strategy

drawtext captions appear as a dimmed lower-third bar with centered white text. If drawtext is not available in the installed ffmpeg build, supply a `captionPngPath` as a pre-rendered PNG overlay.

Caption rules:
- Present tense, agent as subject: "Build-loop plans the migration" not "Planning the migration"
- Outcome, not action: "codex lands the fix" not "codex is writing code"
- Keep under ~60 characters — longer text overflows the bar at 36px
- One caption per segment — captions that change mid-segment are not supported; split the segment instead

## Speed

`speed: 1.5` makes all segments play at 1.5x. Useful for idle stretches that couldn't be trimmed. Avoid > 2x on content with visible typing or mouse movement — it looks unnatural. Typical values: 1.0–1.5 for active work, 1.5–2.5 for connecting/loading transitions.

## Limitations

- Audio is unconditionally stripped.
- Segment re-encode uses the spotlight filtergraph; for very long segments this may take time.
- Concat merge uses `-c copy` — all segments must have the same codec, resolution, and frame rate. If segments differ, the merge step will fail with a codec error.
- `captionPngPath` PNG overlay loops via `-loop 1 -shortest`. Static PNGs of any size work; animated GIFs do not.
- The drawtext font path `/System/Library/Fonts/Helvetica.ttc` exists on macOS 11+. On other platforms, supply `captionPngPath` instead.
