# Plan — Spectra macOS UI Best-Practices Pass

One coherent, surgical pass across 6 SwiftUI files (862 LoC total). Single dispatch — synthesis-density routes to Thinking-tier inline. No fan-out: all 6 files form one cohesive design system update where text-tokens, color-tokens, button-style, and loadable-state primitives are introduced once and consumed everywhere; partitioning across implementers would lose coherence.

## Synthesis dimensions: 7 (over 5-dimension threshold → escalate)

1. Visual hierarchy (Calm Precision + HIG)
2. Accessibility (labels, hints, Dynamic Type, keyboard)
3. Button state ramp (enabled-prominent / disabled-muted)
4. Async state handling (empty/loading/error)
5. Graceful degradation (API/Keychain/connection)
6. Plain-language copy (no jargon)
7. User journey friction

## Chunks

```
C1 (Design primitives) ─► C2 (Consume primitives across views) ─► C3 (Docs + journeys)
                                                                     │
                                                                     └─► C4 (Build app + DMG)
```

Strict sequential — C2 depends on C1's tokens existing; C3 documents the result; C4 packages it. No parallel_batch — these are not parallel-safe; later chunks read primitives introduced by earlier ones.

`parallel_skipped_reason: token-introduction must precede consumption; chunks are sequentially dependent`.

### C1 — Design primitives (new file)

**Owner files (new):**
- `macos/Spectra/Views/DesignTokens.swift` — text-tokens (title/body/caption/footnote semantic sizes via stock `Font` calls, Dynamic-Type-safe) + color-tokens (semantic `.surfaceSubtle`, `.surfaceWarn`, `.surfaceError`, `.surfaceInfo` mapped to system colors).
- `macos/Spectra/Views/ActionButtonStyle.swift` — `EnabledProminentStyle` + `EnabledStandardStyle` view-modifier helpers that visually emphasize when enabled and mute when disabled (single source of truth).
- `macos/Spectra/Views/LoadableState.swift` — `enum LoadableState<T> { case idle, loading, empty, error(String, recovery: String?), loaded(T) }` plus a `LoadableView<T, Content>` wrapper that switches render path per case.
- `macos/Spectra/Views/Copy.swift` — central plain-language strings (replaces "daemon", "AX tree", "stdio" with user-facing equivalents: "Spectra background service", "permission to read other apps", "the helper").

**No code is deleted in C1** — these are additive primitives that C2 then consumes.

**files_touched:** 4 new
**owns:** {`DesignTokens.swift`, `ActionButtonStyle.swift`, `LoadableState.swift`, `Copy.swift`}
**does not own:** any existing view file
**interface contract:** files compile as a standalone target; no behavior change yet.
**integration checkpoint:** `xcodebuild` (no-sign) builds; tests still pass at 25/25.
**modifies_api:** false (purely additive new files; no caller-site changes yet)
**risk_reason:** none

### C2 — Apply primitives across the 6 view files

**Owner files:**
- `macos/Spectra/SpectraApp.swift`
- `macos/Spectra/ViewModels/SpectraViewModel.swift` (minor — surface `walkthroughRunning`, `lastErrorMessage` already there; introduce `friendlyDaemonStatus` computed string that uses Copy.swift; replace raw `error.localizedDescription` with `RecoveryError.from(error)` in 3 catch sites — Anthropic, Keychain, Connection)
- `macos/Spectra/Views/RepoPicker.swift` — apply text tokens, add `.accessibilityLabel`/`.accessibilityHint` to Browse + each Recent button, add empty-state CTA copy ("Choose a project folder to begin"), single-border grouping already present.
- `macos/Spectra/Views/SettingsView.swift` — Save/Remove use new `EnabledProminentStyle`/`EnabledStandardStyle`, add `.accessibilityLabel`, replace "The daemon never sees it" with "The helper never sees it", show `Stored — Standard (unsigned build)` only on actual unsigned tier (already done), wire `RecoveryError` into Keychain catch.
- `macos/Spectra/Views/AccessibilityPanel.swift` — replace "Accessibility access required" body text "Spectra reads the accessibility tree of other apps" with plain language; add `.accessibilityLabel` to all three buttons; primary button becomes prominent only when conditions met.
- `macos/Spectra/Views/MenuBarPopover.swift` — apply text tokens uniformly; introduce `ActionButton` wrapper consuming style; sessions list gets a `loadingPlaceholder` when polling but `sessions.isEmpty && activeSessionId == nil` and `daemonStatus == .ready`; daemon-unreachable card uses Copy.swift's `helperOfflineTitle` instead of "Daemon not running"; status-pill text "REC" replaced with "Recording" (or kept but with `.accessibilityLabel("Recording in progress")`); error toast uses `RecoveryError` shape (title + recovery action button).

**files_touched:** 6 existing
**owns:** the 5 view files + SpectraViewModel.swift + SpectraApp.swift
**does not own:** any file outside `macos/Spectra/Views/`, `macos/Spectra/ViewModels/`, `macos/Spectra/SpectraApp.swift`. ZERO edits to `src/`, `web-ui/`, `tests/`.
**interface contract:** view-model public API unchanged. New computed properties (`friendlyDaemonStatus`, etc.) are additive. View signatures unchanged.
**integration checkpoint:** `xcodebuild test` 25/25 must remain green.
**modifies_api:** false (additive computed properties on ViewModel; public methods unchanged)
**risk_reason:** none (UI-only changes, no security boundary, no persistence contract, no runtime protocol, no deployment, no user trust claim).

**Path B (typed-contract extension) vs Path A**:
- Path A would inline disabled-state ramps in each button site. Forecloses: Dynamic-Type adaptation, future button-color theme, future button-state telemetry.
- Path B introduces `ActionButtonStyle` modifier + `Copy.swift` token table once. Cited capability: future support for keyboard-shortcut tooltips, future theming for high-contrast mode (HIG mandates this for accessibility apps), future i18n.
- Choosing Path B per pay-it-forward default. Cost: ~80 extra LoC across 4 new files (still under 1000 LoC total surface). Saves N×patch-sites on every future button change.

### C3 — UX_JOURNEYS.md docs

**Owner files (new):**
- `docs/UX_JOURNEYS.md` — top 3 journeys with steps + friction notes:
  1. **Pick a project → start capturing** (Browse → click Start → recording).
  2. **Configure API key for walkthroughs** (Settings → paste sk-ant-… → Save).
  3. **Run an AI walkthrough on a chosen repo** (pick repo → type instruction → Run walkthrough → see outcome).

For each: prerequisites, steps, current friction observed in code, what changed in this build. No screenshots required (ibr:native-testing requires a live app; we'll embed text annotations from code review instead — documented separately if the user wants live captures).

**files_touched:** 1 new
**modifies_api:** false
**risk_reason:** none

### C4 — Rebuild app + DMG

**Owner files:** none (build artifacts only)
**Action:** `npm run build:dmg:adhoc` from repo root after C1–C3 commit.
**Verification:** `Spectra.app` + `Spectra.dmg` present at repo root with newer mtime than the source files.
**modifies_api:** false
**risk_reason:** none

## Verification (final pass)

1. `xcodebuild -project macos/Spectra.xcodeproj -scheme Spectra -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO test` → 25/25 ✅
2. `grep -cE "\.accessibilityLabel\(" macos/Spectra/Views/*.swift macos/Spectra/SpectraApp.swift` ≥ button count (15+).
3. `grep -nE "\"[^\"]*(AX tree|JSON-RPC|stdio|IPC|MCP)[^\"]*\"" macos/Spectra/Views/*.swift macos/Spectra/SpectraApp.swift` returns no UI strings (comments/identifiers OK).
4. `grep -nE "Text\([^)]*\"[^\"]*daemon" macos/Spectra/Views/*.swift macos/Spectra/SpectraApp.swift` returns no user-facing strings (internal `daemonStatus` etc. OK as symbols).
5. Manual code-review pass — each `Button { … } label: { … }` block in 5 view files has either `.buttonStyle(.borderedProminent)` gated by enabled-state OR a custom `EnabledProminentStyle()` modifier when the action represents intent.
6. `npm run build:dmg:adhoc` → ✅ `Spectra.app` + `Spectra.dmg` at repo root.
7. `docs/UX_JOURNEYS.md` lists 3 journeys.

## What's NOT in this plan

- Web UI (parallel worktree).
- C7.a benchmark validity fixes.
- DMG codesigning / provisioning.
- New SwiftUI features beyond what HIG/CP require.
- Edits to `src/`, `web-ui/`, `native/`, `tests/` (TS test suite untouched; Swift tests untouched).
