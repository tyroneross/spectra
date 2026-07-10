# Spectra M1 privacy attribution — live verification and RCA

**Date:** 2026-07-10  
**Branch:** `codex/marketing-content-loop`  
**Rally blocker:** `fact_6edf_18bf9c15e8951b50`  
**Host:** macOS 26.0.1 (25A362)

## Bottom line

The Rally blocker is valid. Spectra's current production launch topology bypasses the signed app bundle and executes capture-sensitive processes from `~/.spectra/bin`. macOS therefore attributes Screen Recording to bare executables instead of `dev.spectra.app`.

A live launchd A/B probe isolated the cause:

- The bare preflight executable resolved to **no attributed bundle** and a path-based TCC subject.
- The same Developer-ID-signed executable inside `Spectra.app/Contents/Helpers` resolved to **`Spectra.app`** and TCC subject **`dev.spectra.app`**.

The helper's distinct signing identifier is not the defect. Its external execution path is.

No `macos/Spectra` code was changed because `rally check before-write --strict` correctly returned `allow: false` for that scope. Native Campaign Studio implementation also remains deferred until one mockup is explicitly approved.

## Acceptance status

| M1 criterion | Status | Evidence |
|---|---:|---|
| Signed app bundle | PASS | Release `Spectra.app` has identifier `dev.spectra.app`, Developer ID team `Q6TB8685V9`, and passes `codesign --verify --deep --strict`. |
| Accessibility attribution | PARTIAL PASS | Live pane shows **Spectra**, but also shows `spectra-daemon-core`; screenshot: `/tmp/spectra-m1-accessibility-pane-live-2026-07-10.jpeg`. |
| Screen Recording attribution | FAIL | Live pane has `spectra-daemon-core`, `spectra-daemon-launcher`, and `spectra-native`; it has no Spectra row. Screenshot: `/tmp/spectra-m1-screen-recording-pane-live-2026-07-10.jpeg`. |
| Real bundled capture | BLOCKED | The installed/production launch path still externalizes the TCC-sensitive processes. |
| Required OS target | BLOCKED | The acceptance plan calls for macOS 26.1; this host is 26.0.1. |

## Decisive live evidence

Both probes ran under launchd and used `--no-request`, so they read TCC state without presenting or accepting a permission prompt.

```bash
launchctl submit \
  -l dev.spectra.tccprobe.bare \
  -o /tmp/spectra-tccprobe-bare.out \
  -e /tmp/spectra-tccprobe-bare.err \
  -- "$HOME/.spectra/bin/spectra-screen-recording-preflight" --no-request

launchctl submit \
  -l dev.spectra.tccprobe.embedded \
  -o /tmp/spectra-tccprobe-embedded.out \
  -e /tmp/spectra-tccprobe-embedded.err \
  -- "/path/to/Spectra.app/Contents/Helpers/spectra-screen-recording-preflight" --no-request
```

The unified TCC log reported:

```text
bare:
BUNDLE_ATTRIBUTION: executable path .../.spectra/bin/spectra-screen-recording-preflight
resolves to attributed bundle: (null)
Handling access request ... Sub:{/Users/.../.spectra/bin/spectra-screen-recording-preflight}

embedded:
BUNDLE_ATTRIBUTION: executable path .../Spectra.app/Contents/Helpers/spectra-screen-recording-preflight
resolves to attributed bundle: .../Spectra.app/
Handling access request ... Sub:{dev.spectra.app}
```

Both probes returned denied. That is expected: the current Screen Recording pane has no grant for `dev.spectra.app`. The important result is that the embedded executable produces the correct app subject before any grant is changed.

## Root cause

M1 added bundle-first helper support, but the later M3.G1 topology bypasses it.

1. `macos/Spectra/Daemon/LaunchAgentManager.swift:74-92` constructs paths under `~/.spectra/bin`.
2. `LaunchAgentManager.swift:97-197` writes both LaunchAgents with those bare program paths.
3. `macos/Spectra/DaemonCore/BridgeClient.swift:75-85` defaults the AX helper to `~/.spectra/bin/spectra-native`.
4. `macos/Spectra/DaemonCore/RecordingOps.swift:302-313` independently resolves recording and cursor helpers from the same external directory.
5. `macos/Spectra/DaemonCore/PermissionOps.swift:43-56` performs Accessibility and Screen Recording probes in daemon-core itself. Daemon-core must therefore also remain inside the signed bundle.
6. `macos/Makefile:31-33` embeds six helpers but omits `spectra-daemon-core`.
7. `src/native/compiler.ts:153-213` can resolve embedded helpers, but only through explicit environment overrides or an app installed in `/Applications` or `~/Applications`.
8. `/Applications/Spectra.app` is currently an older ad-hoc build with no `Contents/Helpers`, so the TypeScript resolver returns `null`.

The live host also has contaminated state:

- Three Spectra instances run from build, staging, and mounted-DMG locations.
- Three `~/.spectra/bin/spectra-native` processes have been orphaned under PID 1 since July 4.
- The live external helpers do not share one stable signing form: daemon-core is Developer ID, daemon-launcher is Apple Development, and spectra-native is ad hoc.
- The two daemon sockets remain on disk even though the LaunchAgents are not currently loaded.

This explains why visible privacy rows and current executable validity disagree.

## Remediation

### Minimum fix for the M1 acceptance gate

1. Embed `spectra-daemon-core` with every TCC-sensitive helper.
2. Make shipped LaunchAgent program paths point into the installed app's `Contents/Helpers`; never copy or execute the shipped capture path from `~/.spectra/bin`.
3. Set `SPECTRA_APP_BUNDLE_PATH` and `SPECTRA_NATIVE_HELPER_PATH` in both agent environments.
4. Make `RecordingOps` and cursor resolution honor the same embedded-helper override as `BridgeClient`.
5. Sign the app and every nested executable with one stable identity and team, then sign the outer app last.
6. Add `AssociatedBundleIdentifiers = [dev.spectra.app]` to any retained legacy LaunchAgent templates. This improves legacy service association but does not replace the embedded execution path.
7. Make status-only permission checks invoke the preflight executable with `--no-request`. The visible app should own the actual permission request.
8. If Spectra ships system-audio capture, add a clear `NSAudioCaptureUsageDescription` purpose string.

### Preferred durable architecture

Move both background services to `SMAppService.agent(plistName:)`, keep their plists in `Contents/Library/LaunchAgents`, and use a bundle-relative program. Apple defines `SMAppService` as the API for helpers that live inside the app bundle and as the replacement for copying plists into `~/Library/LaunchAgents`. Apple also documents that bundled LaunchAgents associate with their enclosing app. See [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice), [agent(plistName:)](https://developer.apple.com/documentation/servicemanagement/smappservice/agent%28plistname%3A%29), and [Updating helper executables from earlier macOS versions](https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos).

For the strongest single-row attribution, let `Spectra.app` own the ScreenCaptureKit stream and use embedded services for encoding, analysis, and persistence. If a helper must own the stream, keep it in-bundle and re-prove the exact privacy-pane presentation on the shipping OS. Apple's responsible-process model is covered in [Protect your Mac app with environment constraints](https://developer.apple.com/videos/play/wwdc2023/10266/).

## Closure gate

Do not resolve the Rally blocker until all checks pass:

1. Install one current, signed app at `/Applications/Spectra.app`; do not validate from a build directory or mounted DMG.
2. Confirm `codesign --verify --deep --strict` and team `Q6TB8685V9` for the app and every executable.
3. Confirm `launchctl print` shows programs under `/Applications/Spectra.app/Contents/...`.
4. Trigger daemon-core, preflight, native capture, and composite capture while streaming TCC attribution logs; each request must resolve to `Sub:{dev.spectra.app}` and no new bare-path subject.
5. Capture unobscured Screen & System Audio Recording and Accessibility panes showing Spectra enabled.
6. Produce a real daemon-mediated capture that is non-empty, non-black, and playable after app relaunch.
7. Repeat on macOS 26.1, or update the acceptance criterion through an explicit product decision.
8. Prefer a fresh macOS user or VM for final evidence; stale TCC rows can remain after binaries change.

The permission grant and any TCC cleanup are user-present actions. This audit did not alter those settings.

## Branch and merge readiness

No other local branch needs to merge before this marketing branch:

- `main` and `origin/main` both point to `f3129c8`; the canonical main worktree has pre-existing unrelated build-loop files and remains untouched.
- `codex/marketing-content-loop` is clean and eight commits ahead of main.
- `codex/m4-cdp-port` has one unique commit hash, but `git cherry main codex/m4-cdp-port` marks it patch-equivalent to the CDP port already on main; endpoint diff for the CDP files is empty.
- `feat/ui-reskin-aurora-glass` and the old Rally/worktree branches are ancestors of main.
- `fix/recording-finalize-yuv420p` should not merge first: this branch already carries the needed finalizer implementation and expanded tests in `c32d72f`, while the older branch also changes generated and frozen contract surfaces.

## UI continuation gate

The design target is ready, but implementation is not yet authorized:

- `mockups/00-scratch-spectra-campaign-window.html` — structural wireframe
- `mockups/01-spectra-campaign-window-aurora-glass.html` — recommended Aurora Glass target
- Gallery: `http://localhost:8884`

Both remain unrated. Select the Aurora Glass target before production UI work begins. Even after selection, the Campaign Studio implementation stays behind the privacy-attribution fix above.
