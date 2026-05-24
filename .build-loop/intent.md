# Intent — Spectra macOS UI Best-Practices Pass

## North star
Spectra is a menu-bar content-capture app. The macOS UI is the human surface for an LLM-driven walkthrough engine. It should feel native, calm, predictable, and trustworthy — the operator picks a repo, types what to capture, and gets media files. Nothing should require the user to know there is a background process or an API protocol.

## Update intent
Bring the macOS SwiftUI surface (6 files, 862 LoC) up to Apple HIG + Calm Precision standards in one pass:
- Every action button has a distinct enabled/disabled visual ramp (user's standing rule).
- Every interactive control carries `.accessibilityLabel`; non-obvious actions also carry `.accessibilityHint`.
- Every async-dependent view handles empty/loading/error states explicitly.
- Anthropic/Keychain/connection failures degrade gracefully with recovery paths.
- No user-facing jargon: "AX", "daemon", "stdio", "IPC", "JSON-RPC", "MCP".
- 3 user journeys identified and friction-minimized.

## Out of scope (this build)
- Web UI (parallel worktree owns it).
- TypeScript daemon code (`src/`) — not edited.
- DMG codesign / provisioning (still blocked on cert).
- Behavior changes beyond what HIG/Calm Precision require.

## Constraints
- Tests stay green (25/25). Run with `CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO` since this worktree has no signing cert.
- Stock SwiftUI only — no new packages.
- Durable fix posture: introduce shared style/token primitives (button modifier, text tokens, loadable state enum) rather than patch each call site.

## Synthesis dimensions
1. Visual hierarchy (Calm Precision + HIG)
2. Accessibility (labels, Dynamic Type, contrast, keyboard)
3. Button state ramp (enabled-prominent / disabled-muted)
4. Async state handling (empty/loading/error)
5. Graceful degradation (API/Keychain/connection)
6. Plain-language copy (no jargon)
7. User journey friction

Count: 7 — over the 5-dimension threshold. Synthesis-density routing → escalate to Thinking-tier inline (no fan-out).

## Triggers
- uiTarget: native macOS (`MenuBarExtra`)
- platform: macOS
- riskSurfaceChange: false (UI-only; no boundary crossings)
- promptAuthoring: false
- structuredWriting: false
