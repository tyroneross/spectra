# Aurora Glass re-skin — visual evidence

Captured 2026-05-24 against commit `8a98ded` on branch `feat/ui-reskin-aurora-glass`.

See `.ibr/ui-guidance/active.md` for the full rationale and token map.
Source template: `~/dev/git-folder/UI Guidance/aurora-glass.md`.

## macOS

| File | What it shows |
|---|---|
| `macos/popover-aurora-glass.png` | Menu-bar popover. Indigo (#818cf8) "Open System Settings" prominent CTA with white label and soft glow. Subtle blue-glow info card on the permission prompt (`SpectraSurface.info` = accent at 10% alpha). Amber-tinted warning card on the helper-offline section (`SpectraSurface.warning`). Standard buttons (Stop, Open in Finder) show the glass `--surface` fill with `--glass-border` hairline. |
| `macos/settings-aurora-glass.png` | Settings sheet over popover. Indigo "Save key" prominent button. Standard "Remove key" with disabled visual treatment. The white sheet chrome is system-default macOS sheet treatment — out of scope for token-only re-skin (would need `.preferredColorScheme(.dark)` or structural change). |

Captured via `screencapture -x -o -R 948,35,380,614 …` against the ad-hoc built `Spectra.app` (`make build-adhoc` succeeded).

## Web

| File | What it shows |
|---|---|
| `web/captures-aurora-glass.png` | `/captures` page. Active "Captures" tab shows the Aurora Glass accent-glow pill (indigo background tint + indigo text). Other tabs (Sessions, Export, Guidance, Archive) inactive (zinc-400). Subtle ambient gradient hotspots faintly visible in the dark field. |
| `web/export-aurora-glass.png` | `/export` page. Active "Export" tab pill. Three-step chevron (1 Select › 2 Annotate › 3 Export) renders on the dark Aurora Glass field. |
| `web/guidance-aurora-glass.png` | `/guidance` page. Active "Guidance" tab pill. "New Playbook" + "Create Playbook" CTAs use the new Aurora Glass indigo (`--primary` rebound to `234 89% 74%`). |

Captured via `ibr --base-url http://localhost:4300 start /<route>` after `npm run dev`.

## Tests

All four suites green on commit `8a98ded`:

- `npm test` (root): 483/483 pass
- `npx tsc --noEmit` (root): clean
- `cd web-ui && npm test`: 17/17 pass
- `cd web-ui && npx tsc --noEmit`: clean
- `cd macos && make test-adhoc` (xcodebuild test): 27/27 pass
