# Plan — Spectra end-to-end record→polish + Sonnet-5 measurement

Run: bl-spectra-20260630T190943Z-claude_code · base commit 07e1b65 · branch main
(Prior plan "P1 Docs + P2 Async recordComposite" archived to build-loop-memory/projects/spectra/archive/plans/2026-06-30/.)

## Headline
Unify Spectra's three disconnected polish implementations into ONE record→auto-polish→
captioned/bannered/spotlight flow that reproduces the `demo-candidates/polished/` look,
make rendering substantially faster, and thread captured audio through. Plus a Sonnet-5
measurement harness (this build's subagents + Benchmark Lab feed + health watch).

## Doctrine reconciliation (PRD)
PRD core principle = "one real run → one shareable mp4, no post-editing." Reconcile:
raw capture stays edit-free (principle intact); **polish is an explicit opt-in 2nd stage.**
Update `docs/prd-spectra-composite.md` pivot log to sanction polish as a first-class stage.

## Target style spec (from MERGED_CAPTIONED, measured)
- Banner: bottom, full-width, ~12% frame height, bg `#050709` ~90% opacity.
- Chip: squircle ~64×58, radius ~12, bg `#27AFE8`, white bold number, inset ~52px left.
- Caption: `#F8FAFC`, sans-serif, single line, ~25px right of chip, vertically centered.
- Spotlight (per-beat): sharp focal pane full brightness; non-focal feathered (~20–30px)
  blur+darken crushing to near-black; true `#000` letterbox around window chrome.
- Speed: uniform multiplier (1.6/1.8/2.0x), no variable ramp needed.

## Chunks (single-writer ownership; implementers never commit)
- **C0 Measurement harness** [DONE] — `.build-loop/measurements/` logger + schema. Ongoing per dispatch.
- **C1 Style consolidation** — owns `src/pipeline/text-render.ts, framing.ts, annotations.ts`
  + tests. One canonical banner+chip+caption renderer matching the spec above. Numeric
  acceptance: sampled banner/chip/text pixels within tolerance of spec hex.
- **C2 Spotlight unification** — owns `src/pipeline/` spotlight path; reconcile vs
  `src/media/spotlight.ts buildSpotlightFilter`. Feathered blur+darken focal mask + #000 letterbox.
- **C3 Performance** — owns `src/pipeline/framing.ts` (mask/shadow render) + `src/pipeline/polish.ts`
  (wire PNG input). FIX: replace per-frame `geq=lum=` rounded-rect mask (framing.ts:80 — 87% of
  render time, recomputes a STATIC mask 600×/clip) with a precomputed mask PNG looped as input
  (the `buildStaticFramePlan` pattern already in polish.ts). Secondary: same for the 3 `gblur`
  shadow layers. Measured target: **~7.0x** (56.9s→8.1s on a 10s clip), PIXEL-IDENTICAL output.
  Do NOT use fps-30 (smoothness loss) or `h264_videotoolbox` (no gain, CRF-semantics risk).
  ⚠️ SEQUENCING: C3 edits framing.ts — same file as C1. MUST run AFTER C1 commits (no parallel).
- **C4 Contract + MCP wiring** — owns `src/contract/{core-api,schemas,contract.snapshot.json,
  contract.test.ts}`, `src/mcp/tools/demo.ts`(+/or new), `src/mcp/forward.ts`,
  `src/daemon/core-impl.ts` dispatch. Expose `polishClip/polishScript` as a real operation;
  add opt-in `record→auto-polish` chaining; thread audio (drop `-an` when audio present, mux).
  Regenerate contract snapshot. NOTE: same files Block-4 audio touched — audio committed
  (a2ebb66), working tree clean, so no live conflict; just re-baseline drift.
- **C5 Zoom data source** — owns recording telemetry path. Emit `{tMs,cx,cy}` during record,
  OR (fallback) derive zoom windows from scene-detect (autoRampDemo already scene-detects)
  when no click JSON. Scope to the cheaper viable path first.
- **C6 End-to-end command + proof** — `/spectra:record` extension or `/spectra:polish`; docs;
  PRD pivot. Produce one real polished sample clip as proof.

## Dependencies / parallelism
- Parallel-safe now: C1, C3 (mostly disjoint files; C3 touches polish.ts render args only).
- C2 after/with C1 (shared framing concepts). C4 after C1+C2 (calls stable renderers).
- C5 independent. C6 last (depends C4).

## Verification boundary (honest)
- Polish/styling/perf (ffmpeg on existing mp4) → fully verifiable from CC bash (real renders + pixel sampling).
- Record/capture half (ScreenCaptureKit) → CANNOT run from CC bash (CGS_REQUIRE_INIT); verify
  structurally (contract + unit tests) here; live capture needs MCP server + CC restart, or codex rally.
- Final aesthetic sign-off on the look → hand to user (headless visual-judgment limit).

## Sonnet-5 measurement (3 arms)
1. This build: every Sonnet-5 dispatch logged to `sonnet5-<run>.jsonl` (wall_ms, tokens, outcome, errors).
2. Health watch: capture any 429/529/overload/retry surfaced during dispatches → `measurements/health/`.
3. Benchmark Lab feed: at Review-G, write a real-task Sonnet-5 data point to
   `~/dev/git-folder/prompt-model-benchmark-lab`.
