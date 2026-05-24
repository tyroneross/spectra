# Goal — Spectra v1 menu-bar app

## Statement
Ship `Spectra.app` + `Spectra.dmg` at the spectra repo root, signed with Apple Development cert (Team ID `7AK2KDLAVP`), that turns a directory pointer + a plain-language instruction into a captured walkthrough end-to-end, with the existing Claude Code stdio MCP path untouched.

## Acceptance criteria (Phase 4 graders against these — verbatim from brief)

1. From a clean machine, `npm run build:dmg` (or equivalent) produces `Spectra.app` + `Spectra.dmg` at spectra repo root, both `codesign --verify --deep --strict` clean.
2. Launching `Spectra.app` from `/Applications` shows a menu-bar icon. Clicking opens a popover with Start / Stop / Save buttons, a repo picker (recents + Browse), an instructions text field, and a recent-captures list.
3. Selecting `~/dev/git-folder/travel-planner` launches the dev server, scopes captures to `travel-planner/.spectra/sessions/<id>/`, and starts recording without manual intervention.
4. Typing "open the home page, scroll to the camp list, click the first card" and hitting "Run walkthrough" produces an executed walkthrough with screenshots stored alongside the session, driven by Claude (not the rules engine).
5. The existing Claude Code stdio path still works — `spectra:capture` from a Claude session is unaffected.
6. Killing `Spectra.app` does not orphan the daemon (launchd cleans up) and does not delete captures.
7. **Text-input walkthrough quality.** ≥85% end-to-end success on a benchmark set of ≥8 representative tasks. Median latency per step ≤3.5s. Median tokens/step ≤2500 input + 400 output.
8. **UI video recording quality.** Default profile produces 1080p30 h264, ≤8 MB/min, SSIM ≥0.94 vs source on a 60s reference flow, zero dropped frames over 5min, <25% sustained CPU on M-series. Stop/save gap-free.

## DOE binding (long-run mandate)

Criteria 7 + 8 are not "best effort." Phase 5 Iterate runs the full DOE protocol per criterion (≤16 factorial + ≤6 1FAT refinement) before declaring convergence. Verdicts written to `.build-loop/experiments/<criterion>/verdict.md`.

## Verification flow (user-side)
- `ls -la ~/dev/git-folder/spectra/` shows `Spectra.app` + `Spectra.dmg`
- `codesign --verify --deep --strict ~/dev/git-folder/spectra/Spectra.app` exits 0
- Drag `Spectra.dmg` → /Applications → launch → run criteria 3+4 against travel-planner
- Separate Claude session: `/spectra:capture` against any URL still works (criterion 5)
- `curl -H "Authorization: Bearer $(cat ~/.spectra/daemon.token)" http://127.0.0.1:47823/api/version` returns `{ apiVersion, daemonVersion }`
- `launchctl print gui/$(id -u)/dev.spectra.daemon` shows registered + running
