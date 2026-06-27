---
name: spectra-composite
status: draft
revision: 0.1.0
last_updated: 2026-06-26
load_when: "Any non-trivial change to Spectra recording/compositing, the composite MCP tool/command, or the dogfood demo pipeline."
evolves_when: "Recording engine changes (avfoundation ↔ ScreenCaptureKit), pane model changes, or the demo scenario / integrity rule changes."
core_principles:
  - "Local-only capture — nothing leaves the machine."
  - "One command + one real run → one shareable mp4, no post-edit."
  - "On-camera multi-agent coordination is real work, never staged."
  - "MVP yields a real artifact with zero native deps; native rung is opt-in."
---

# PRD — Spectra Composite Recording + Dogfood Demo

## How to use this PRD
Read this before any non-trivial change to Spectra's recording/compositing path or the demo pipeline. It is the upstream spec the build-loop planner reads to author chunks. Technical ground truth (already source-verified) is in **Architecture & Ground Truth** — trust it over re-deriving.

## LLM Navigation Map
- **Building the recorder?** → Architecture & Ground Truth, Methodology (Rung 1 / Rung 2).
- **Deciding a capture engine?** → Architecture & Ground Truth (avfoundation vs ScreenCaptureKit), Stance (complexity).
- **Designing the demo?** → Outcome, Methodology (Demo), Integrity rule.
- **Prioritizing a feature request?** → Persona, Non-goals, North Star.
- **Privacy / where artifacts go?** → Stance (privacy).

## Intent
Add a **composite recording mode** to Spectra that produces ONE synchronized side-by-side `.mp4`: left pane = a terminal window (the live Claude Code TUI showing build-loop + Rally Point + codex coordination), right pane = a browser page (Atomize AI) driven by IBR end-to-end UI tests. Dogfood it by recording the demo of itself.

## North Star
**Time-to-shareable-demo.** A credible video of agentic computer-use + multi-agent coordination is produced by a single Spectra command plus one real scenario run — no manual dual-recording, no editing. If a change makes the artifact need post-editing to be shareable, it regressed the North Star.

## Persona & Trigger
- **User:** the operator (Tyrone) and anyone demoing RossLabs agent tooling — wants proof-grade demo videos without the manual record-two-things-then-edit loop.
- **Triggers:** (a) a capability is worth showing (computer use, Rally Point, IBR-on-a-real-app); (b) dogfooding Spectra on a real multi-pane scenario; (c) social proof of agents coordinating.
- **Is NOT:** a video editor · a CI/test tool (that is IBR) · an OBS-style streaming app · a consumer product · an Atomize AI feature.

## Outcome (measurable)
One clean side-by-side mp4 (terminal + Atomize/IBR) from a **single `/spectra:record composite` + one run**, including a genuine on-camera rally→codex handoff, shareable as-is. Replaces the manual multi-tool capture+edit workflow.

## Methodology
Two-rung build, dogfooded; ship a real artifact at Rung 1 and climb only as needed.

**Rung 1 — MVP (crop + hstack, zero native code):**
1. Device-index discovery — replace hardcoded `-i '1:none'` with a probe (`ffmpeg -f avfoundation -list_devices true -i ""`, parse stderr screen indices).
2. Stage terminal + browser as tiled windows; capture the full display via the **existing** `pipeline.ts` avfoundation path.
3. ffmpeg `-filter_complex` crop two regions → scale to equal height → `hstack` → one mp4 (`shortest=1`).
4. Expose as `spectra_record` composite mode (MCP tool) + `/spectra:record` command.
5. Build local Spectra + relink the plugin (installed 0.3.2 cache lacks the video pipeline).

**Rung 2 — Durable v1 (ScreenCaptureKit per-window):**
A small Swift CLI using `SCContentFilter(desktopIndependentWindow:)` captures the terminal window + browser window independently (occlusion-proof, survives window movement) → `hstack` with pane labels. Hosted via Spectra's existing native bridge pattern.

**Demo (recorded by the above):**
- Browser pane: IBR runs `test-search` + per-page button/nav assertions on Atomize AI.
- Terminal pane: build-loop orchestrates; Rally Point shows a real handoff to codex.

### Integrity rule (non-negotiable)
The on-camera rally→codex handoff is **real work**, never staged: IBR finds an issue on an Atomize page → build-loop hands triage to codex over rally → codex responds. No mock coordination, no replayed script presented as live.

## Stance
- **Privacy/Data:** capture is **fully local** (ffmpeg / ScreenCaptureKit on-device; artifacts in repo `.spectra/`); nothing uploaded; no cloud rendering — because recordings of dev sessions may contain secrets/tokens. Local-only is the safe default.
- **Complexity:** default path = one command with sane defaults (staged tiling, 30fps, h264); ScreenCaptureKit per-window + pane labels is the **opt-in advanced rung** — because the MVP must yield a real artifact with zero native deps.
- **Cost:** free internal tooling inside the Spectra plugin; cost is dev time, no per-use $.

## Non-goals (illustrative)
- No changes to atomize-ai — it is the system-under-test.
- No compositing editor / timeline UI.
- No physical-iOS-device capture (simulators only, already supported elsewhere).
- No cloud rendering or upload.
- Not a general screen-recorder/streaming product.

## Architecture & Ground Truth (source-verified 2026-06-26)
Repo: `/Users/tyroneross/dev/git-folder/spectra` (`@tyroneross/spectra`; local source AHEAD of installed 0.3.2 plugin).
- **Single-source video already exists** — `src/media/pipeline.ts`: ffmpeg avfoundation capture (`buildCaptureArgs` web/macos → `-f avfoundation -framerate N -i '1:none' -c:v libx264rgb -crf 0`), VideoToolbox hardware encode, fps/codec/bitrate options, probe + poster-frame.
- **Recording is MCP-wired** — `src/mcp/tools/capture.ts`: `start_recording` / `stop_recording` with an arming→recording→encoding→saved state machine and DOE control points.
- **Gaps to build:** (1) capture input hardcoded to whole display index 1; (2) no compositing (no multi-input `hstack`/`overlay`); (3) local build is not the installed plugin (must build + relink).
- **Engine facts (researched):** avfoundation captures **displays, not windows** (crop-from-fullscreen for Rung 1); **ScreenCaptureKit** is the per-window path (Rung 2); ffmpeg `hstack` needs equal heights + `shortest=1`.
- **Related modules:** `src/terminal/{recorder,multi-recorder}.ts` (asciicast + timeline — reference for multi-source coordination), `src/native/bridge.ts` (Swift helper host), `src/cdp/` (browser driver).

## Roadmap stance
Rung 1 first and fully (real shareable artifact). Rung 2 only if Rung 1's staged-tiling fidelity is insufficient for a clean demo. No speculative formats (vstack/grid/PiP) until asked.

## Risks
- macOS screen-recording **TCC permission** — one-time grant, needs an operator click.
- avfoundation **device-index variance** per machine — Rung 1 probes it at runtime.
- Live **codex latency** — rehearse the handoff off-camera, then one real take.

## Open questions
- Atomize AI local run command + dev URL (resolve at build P0 / NavGator in-repo).
- Pane aspect ratio target (16:9 vs 21:9) for a clean side-by-side at common display sizes.

## One-line summary
One Spectra command records a synchronized terminal+browser side-by-side mp4 of agents doing real coordinated work — proof-grade demos with no editing.

## Document maintenance
Update on any recording-engine change, pane-model change, or demo-scenario/integrity-rule change. Bump `revision`; log pivots below.

## Pivot log
- 0.1.0 (2026-06-26) — initial draft. Scope set after source review collapsed "build video from scratch" → "add device-index discovery + crop/hstack composite atop existing avfoundation pipeline."

## Linked artifacts
- Research (capture/compositing approaches): persisted via `/research` — avfoundation=display-only, ScreenCaptureKit=per-window, ffmpeg hstack recipe. (Link added on persist.)
