# video-bench/runner.ts — Plan

Same deferral pattern as walkthrough-bench. Scope and contract documented
here so the next dispatch can pick it up cleanly.

## Per-cell loop

For each flow:
1. POST `/mcp tools/call name=spectra_connect arguments={target,repoPath,launch:true}`
2. POST `/mcp tools/call name=spectra_capture arguments={sessionId,type:start_recording,fps,codec,hardware}` (DOE factors map to params per C0 schema)
3. For each script step:
   - POST `/mcp tools/call name=spectra_step arguments={sessionId,intent}` OR sleep(`wait_ms`)
   - If `repeat`, loop step N times
4. POST `/mcp tools/call name=spectra_capture arguments={sessionId,type:stop_recording}` → captures raw mkv + encoded mp4 paths
5. Run ffmpeg SSIM filter, parse mean SSIM
6. Stat encoded mp4 for size
7. (CPU% is sampled during step 2–4 in a background poll)

## Cells (16-cell fractional factorial)

Generator: V5 = V1 * V2 * V3 * V4 (resolution V, all 2-way interactions
clear of main effects).

Enumerated in `design.md` at runtime — committed in the next dispatch.

## Per row schema (runs.jsonl)

```json
{
  "ts": "...",
  "git_sha": "...",
  "cell_id": "V1=h264,V2=4M,V3=30,V4=videotoolbox,V5=off",
  "flow_id": "scrolllist-60s",
  "duration_s": 60.0,
  "size_bytes": 2641392,
  "size_mb_per_min": 2.5,
  "ssim_mean": 0.962,
  "cpu_percent_median": 11.4,
  "dropped_frames": 0,
  "primary_metric": 0.962 / 2.5,
  "raw_path": "/tmp/spectra-bench/cell-07-flow-scrolllist-60s.mkv",
  "encoded_path": "/tmp/spectra-bench/cell-07-flow-scrolllist-60s.mp4",
  "error": null
}
```

## Acceptance for next pass

- `tsx runner.ts --design fractional-factorial-16` produces 48 rows (16 cells × 3 flows) in `runs.jsonl`.
- `analyze.ts` writes `verdict.md` naming winner + runner-up + main-effect estimates.
- Winning factor combination becomes the default `VideoOptions` in `src/media/pipeline.ts` (C7 commit).
- Losing configurations remain reachable via the existing per-call params on `spectra_capture` (already wired in C0).
