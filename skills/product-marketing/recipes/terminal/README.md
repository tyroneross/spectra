# Terminal-demo recipes

Shell scripts that drive REAL terminal content for marketing screen recordings —
a real test suite failing and passing, a real git flow, a real build, a real
lint fix. No toy fixtures (no bare `sum.js`), no simulated output: every
command in these scripts is a real tool running against real (throwaway)
files, at a human-watchable pace. The scripts do not record anything
themselves — a human or a codex-rally GUI session runs the screen/terminal
recorder while one of these plays.

## Recipes

| Script | Shows |
|---|---|
| `redgreen-real.sh` | A real `vitest` suite (pagination helper, 4 tests) — one genuine off-by-one failure, a real one-line fix, GREEN. |
| `git-workflow.sh` | A real git flow: `status` → stage → commit → `log --oneline` → real edit → `diff` → commit. |
| `build-and-run.sh` | A real `tsc` build of a one-file TS CLI (slugify), then running the compiled tool for real output. |
| `plugin-in-action.sh` | A real ESLint pass flags an unused var + `==`/`===` bug, a real fix, re-run at 0 problems. |

Each is self-contained and idempotent: run with no arguments and it scaffolds
a fresh `mktemp -d` workdir, or pass a workdir path as `$1` to reuse one.
Nothing outside that workdir is touched. Total runtime is ~15–25s per recipe.

## How to record one

1. **Terminal setup** — dark, high-contrast theme (e.g. built-in "Dark",
   Dracula, or your editor's default dark scheme); font size **≥18pt**; window
   sized so lines don't wrap mid-command. Hide anything session-specific
   (prompt with cwd/hostname noise, unrelated tabs).
2. **Capture** — either:
   - `asciinema rec demo.cast`, then run the recipe script inside that
     session, `exit` when it finishes, `asciinema play demo.cast` to review; or
   - a screen recording (QuickTime, or the codex-rally GUI session) of the
     terminal window while the recipe runs.
3. **Run the recipe** — `./redgreen-real.sh` (or any of the others). Let it
   play at its own pace; the `beat()` pauses are already tuned for a human to
   read each step. Don't narrate over it live — capture clean, add
   voiceover/captions later if needed.
4. **Polish** — hand the raw capture to Spectra:
   `spectra_capture` → `spectra_demo action=polish-clip style: cool`
   (`cool` = lo-fi/authentic, matches real-terminal credibility per
   `video-design/references/spectra-design-map.md`). Use `warm`/`bold` only
   if the audience calls for a more produced feel — terminal demos read as
   inauthentic if over-polished.

> If `spectra_demo`/`spectra_capture` aren't in your live MCP tool list, the
> Spectra plugin needs a rebuild + Claude Code restart (MCP restart boundary)
> before producing — see `product-marketing/SKILL.md`.

## Design rules that apply to every recipe (from `skills/video-design`)

- **One idea per beat** — each `beat()` in these scripts is exactly one idea
  (one command, one result). Don't cut two recipes together into one clip;
  splice at recipe boundaries, not mid-beat.
- **No dead air > 1s** — every pause here is followed immediately by new
  information (a label, then real command output). If you re-cut for a
  shorter final asset, don't leave a beat's `sleep` running with nothing new
  on screen.
- **Front-load the aha** — lead with the recipe that proves the point
  fastest for the audience (`redgreen-real.sh`'s FAIL→GREEN reads as "it
  actually works" in ~2 beats; save `build-and-run.sh` for developer-heavy
  audiences who want to see a real build pass).
- **Real, colored, moving output** — these scripts set `FORCE_COLOR=1` and
  force git/eslint/vitest color flags so output is colored even when not
  captured from a live TTY. Never substitute a screenshot or static image for
  a beat — the motion (red → edit → green; empty dir → committed history) is
  the point.

## Adding a new recipe

Use `generate-recipe.sh` to scaffold the beat structure (workdir handling,
`beat()` helper, boilerplate) for a new tool sequence:

```
./generate-recipe.sh db-migrate \
  "Real schema, one pending migration|||npx prisma migrate status" \
  "Applying it for real|||npx prisma migrate deploy" \
  "Confirm the new table exists|||npx prisma db pull --print"
```

This writes `db-migrate.sh` next to the others. Each `"Label|||command"` pair
becomes one beat. Edit the generated file afterward to add real fixture setup
(a `package.json`, a genuinely-buggy source file, seed data) — the generator
only wires the shared skeleton, not recipe-specific content.
