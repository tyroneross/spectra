# Spectra macOS — User Journeys

Three top journeys, prioritized by how often new users will touch them. Each lists what the user does, where they touch the UI, and the friction we removed in the May 2026 best-practices pass.

## 1. Pick a project, then capture something

The default first-run journey. The user installs Spectra, sees the menu-bar icon, clicks it, picks a project folder, and starts a capture.

**Touchpoints**

1. Menu-bar icon (top-right) — `viewfinder.circle` symbol. VoiceOver: "Spectra. Background service ready."
2. Popover header — title + status pill ("Ready / Offline / Update needed / Checking…").
3. **Project folder** section → "Choose a folder…" button (`SpectraStandardButtonStyle`). VoiceOver hint: "Opens a folder picker to choose a project for Spectra to capture."
4. After selection, a single-bordered card displays the folder name + path with a folder icon. VoiceOver: "Selected folder: travel-planner."
5. "Recent" list — single bordered group with dividers (Calm Precision: Group, Don't Isolate). Each row's accessibility label names the path.
6. **Start capture** button (`SpectraProminentButtonStyle`) — distinct enabled (filled accent) vs disabled (hollow outline) state. Disabled until a folder is selected AND background service is `.ready`.
7. Optional keyboard shortcut: ⌘S.

**Friction removed in this pass**

- "Browse…" → "Choose a folder…" (verb-first, plain language).
- Empty state was a silent gray box; now shows an explicit call-to-action ("Choose a project folder to start capturing.") with an icon and an accessible label.
- "Start" had no visual distinction between enabled and disabled; now uses the shared `SpectraProminentButtonStyle` which has a hollow muted outline when disabled.
- Hardcoded `Color.gray.opacity(0.08)` → semantic `SpectraSurface.subtle` that adapts to light/dark/high-contrast.

**Dead-end check** ✅ — every state offers a next step:
- No service running → "Install background service" CTA in the popover.
- No folder selected → "Choose a folder…" button is the only enabled action.
- Service ready + folder picked → "Start capture" lights up.

## 2. Configure the Anthropic API key

Required before the user can run walkthroughs. The popover surfaces a hint when the key is missing.

**Touchpoints**

1. Inline hint at the bottom of the popover ("Add an Anthropic API key in Settings to enable walkthroughs.").
2. Gear icon (lower-right of the popover). VoiceOver: "Settings. Opens Spectra settings."
3. Settings sheet opens. Header: "Settings". Done button uses `SpectraStandardButtonStyle`.
4. Anthropic API key panel:
   - Title: "Anthropic API key" (`SpectraText.title`).
   - Help line: "Required for walkthroughs. Stored locally in your Keychain. The helper never sees it." (`SpectraText.description`, secondary color).
   - `SecureField` with placeholder `sk-ant-…`. Accessibility label + hint attached.
   - **Save key** button (`SpectraProminentButtonStyle`, ⌘↩) — disabled with hollow outline until something is typed.
   - **Remove key** button (`SpectraStandardButtonStyle`) — disabled when no key is stored.
   - Status line on the right: "Key stored — protected by Touch ID." / "Mac passcode." / "Standard protection (unsigned build)." / "No key stored yet."
5. On error, an in-panel banner shows a `RecoveryError` shape — title (what failed) + suggestion (what to try). No raw `error.localizedDescription` echoed.

**Friction removed in this pass**

- "The daemon never sees it" → "The helper never sees it." Removes the jargon `daemon` while preserving the (real) privacy claim.
- Save/Remove buttons now visually differentiate enabled vs disabled — user can see at a glance whether Save will actually do something.
- Errors used to surface raw `error.localizedDescription`; now wrapped in a `RecoveryError` with a stable title and a plain-language suggestion.
- ⌘↩ keyboard shortcut on Save (Apple HIG: every primary action should be reachable from the keyboard).
- ⌘, opens Settings (HIG sacred shortcut).
- Esc on the sheet now closes via the Done button (`.keyboardShortcut(.cancelAction)`).

## 3. Run an AI walkthrough on the chosen repo

The highest-value journey — Spectra's reason for existing on macOS.

**Touchpoints**

1. (Assumes journey 1 + 2 already done.)
2. The instruction TextEditor under "What should Spectra walk through?" with a plain-language placeholder ("Describe the flow in plain language. For example: \"Open the home page, scroll to the camp list, click the first card.\""). Accessibility label + hint attached.
3. **Run walkthrough** button (`SpectraProminentButtonStyle` small) — disabled with hollow outline until *all* of: service ready, API key present, capture session active, instruction not empty.
4. When running, the button content swaps to `ProgressView` + "Running…" — VoiceOver value: "Running"; otherwise "Idle".
5. Disabled-state hint (`accessibilityHint`) explains *which* prerequisite is missing in plain language: "Add an Anthropic API key in Settings to enable walkthroughs." / "Start a capture session first." / "Type what Spectra should walk through, then press Run."
6. On completion, outcome line appears below the button: "Walkthrough completed — 7 steps over 4 turns. Used 1843 input + 412 output tokens."
7. On failure, an error toast appears with the recovery shape (title + suggestion) + a Dismiss button.

**Friction removed in this pass**

- The disabled-state hint used to be silent; now `accessibilityHint` names the exact unmet prerequisite.
- Outcome line punctuation tightened (": " → " — ", commas standardized).
- Status pill text "REC" → "Recording" (full word; "REC" was both ambiguous and inaccessible to first-time users).
- The status pill carries an explicit `.accessibilityLabel` separate from the visible text ("Recording in progress" vs the displayed "Recording").
- Error toast wraps raw exceptions in `RecoveryError` shape.

## What did NOT change

- Underlying view-model contract (`SpectraViewModel`'s public API). Adding `recoveryError` was additive.
- The `DaemonStatus` enum or `DaemonClient` wire format.
- Anything in `src/` (TypeScript daemon).
- Anything in `web-ui/` (parallel worktree).
- Test count: 25 XCTest cases still pass.

## Verification

- `xcodebuild -project macos/Spectra.xcodeproj -scheme Spectra -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO test` → 25/25 ✅
- `grep -cE "\.accessibilityLabel\(" macos/Spectra/Views/*.swift macos/Spectra/SpectraApp.swift` ≥ button count.
- `grep -nE "\"[^\"]*(AX tree|JSON-RPC|stdio|IPC|MCP)[^\"]*\"" macos/Spectra/Views/*.swift macos/Spectra/SpectraApp.swift` returns no matches.

## Future work (out of scope here)

- Live `ibr:native-testing` scan once Spectra.app is launched (requires the running app + Accessibility permission). Code-review verification was used for this pass.
- High-contrast mode visual QA on real hardware.
- VoiceOver pass on a Mac with VoiceOver enabled (the labels and hints are coded, but a live screen-reader test would confirm flow).
