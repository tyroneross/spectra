# Goal — Spectra macOS UI Best-Practices Pass

## Goal
Update Spectra macOS SwiftUI views to match Apple HIG + Calm Precision standards with full a11y, distinct button-state ramps, explicit async-state handling, and plain-language copy — without breaking the 25/25 test baseline.

## Scoring criteria (acceptance)
1. **Button state ramp** — every action button (Save, Start, Stop, Done, Install, Run, Remove, Browse) has a distinct enabled (prominent) vs disabled (muted) visual via a shared modifier. Verified by reading each button declaration.
2. **Accessibility labels** — every interactive control has `.accessibilityLabel`; non-obvious actions add `.accessibilityHint`. Verified by grep count ≥ button count.
3. **Async state handling** — RepoPicker, sessions list, walkthrough, daemon-status all show empty/loading/error explicitly. No silent-zero states. Verified by reading view code.
4. **Graceful failures** — Anthropic API + Keychain + connection failures surface a user-readable recovery action, not raw `error.localizedDescription`. Verified by reading the 3 error sites.
5. **No user-facing jargon** — `grep -nE "AX tree|stdio|JSON-RPC|MCP|IPC"` plus user-facing `daemon` strings return ZERO matches in displayed Swift string literals. Internal API symbols may keep `daemonStatus` etc. since they're not displayed.
6. **3 user journeys documented** — `docs/UX_JOURNEYS.md` lists them with friction notes.
7. **Tests green** — `xcodebuild -scheme Spectra -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO test` returns 25/25 passing.
8. **App + DMG rebuilt** — `npm run build:dmg:adhoc` produces `Spectra.app` + `Spectra.dmg` at repo root.

## Pass / partial / fail
- **Pass**: 8/8 criteria green.
- **Partial**: 6/8 — explain which are deferred and why.
- **Fail**: < 6/8 or tests regress.
