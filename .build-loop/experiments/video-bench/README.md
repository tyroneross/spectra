# Video Benchmark

Drives Phase 5 Iterate DOE for **criterion 8** (UI video recording).

## DOE factor design (criterion 8)

| # | Factor | Levels |
|---|---|---|
| V1 | Codec | `h264` / `hevc` |
| V2 | Bitrate target | `4M` / `8M` |
| V3 | FPS | `30` / `60` |
| V4 | Encoder | `software` (libx264/libx265) / `videotoolbox` |
| V5 | Cursor highlight overlay | `off` / `on` (post-process drawbox) |

Design: 5 factors × 2 levels = 32-cell. Fractional factorial **2^(5-1) = 16 runs** (resolution V).

## Metrics

| Metric | Direction | Source |
|---|---|---|
| SSIM (encoded vs source frames) | maximize | ffmpeg `ssim` filter, frame-by-frame, take mean |
| File size MB/min | minimize | `stat -c %s` divided by duration |
| Sustained CPU % | minimize | `ps -o pcpu` polled at 2Hz during encode |
| Dropped frames | minimize | parsed from ffmpeg stderr (`frame= ... drop=N`) |

**Primary metric:** `SSIM × inverse(MB/min)` — single-number tradeoff between fidelity and bandwidth.

**Secondary:** sustained CPU%, dropped-frame count. Used as tie-breakers and as veto conditions (a config with any dropped frames cannot win regardless of SSIM/size).

## Source-of-truth frame extraction

For SSIM, the "source" is the raw mkv that ffmpeg avfoundation produces BEFORE the encode step. The encode step writes mp4. We compute SSIM by:

```
ffmpeg -i raw.mkv -i encoded.mp4 -lavfi "[0:v][1:v]ssim=stats_file=ssim.log" -f null -
```

then parse `All:mean` from `ssim.log`.

## CPU sampling

While the encode is running, sample `ps -o pcpu= -p $FFMPEG_PID` at 0.5s intervals. Report the median over the encode duration (more robust to startup spikes than the mean).

## Running

```
tsx .build-loop/experiments/video-bench/runner.ts \
  --design fractional-factorial-16 \
  --out .build-loop/experiments/video-bench/runs.jsonl
```

Requires:
- Daemon running on 127.0.0.1:47823
- ffmpeg in $PATH
- Each flow's target reachable
- Screen Recording permission granted to the daemon process (avfoundation capture path)
- ~50 min wall-clock per full 16-cell sweep (3 flows × 60s = 3 min recording + ~30s encode per cell × 16 cells)

## Honest scope of THIS commit

`flows.yaml` defines the benchmark surface; `README.md` documents the
protocol and metrics; `runner.ts.PLAN.md` documents the per-cell loop
the next dispatch will implement.

`runner.ts` itself is NOT shipped in C2.5 because:
- C0 lands the recording API but it has not been exercised against
  real screen content (only fakes); the first cold-run will surface
  Screen Recording permission, ffmpeg version skew, and avfoundation
  device-index issues that need triage before benchmark numbers are
  meaningful.
- Per `feedback_no_fake_stats.md`: a runner that emits synthetic
  numbers is worse than no runner at all. Schemas first; runner +
  first real row in the next pass.
