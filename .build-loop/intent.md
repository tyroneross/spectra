<!-- intent_run_id: bl-spectra-m1-attribution-20260710 -->
# Intent — Spectra M1 privacy attribution remediation

## Restated intent

Make the installed native Spectra app own macOS Accessibility, Screen Recording, and system-audio attribution by keeping every TCC-sensitive daemon and helper inside the signed app bundle, then prove the result before starting Campaign Studio production UI.

## North star

Spectra should feel like one trustworthy macOS product: users grant permissions to Spectra once, see Spectra in System Settings, and never have to understand or authorize internal helper binaries.

## Primary users and jobs

- Product builders need reliable screenshots and recordings without debugging helper identities or stale permissions.
- Marketing teams need captures that work consistently enough to power the creative-quality loop already shipped on this branch.
- Native-app users need a clear permission experience with one responsible app identity and truthful recovery guidance.

## Update intent and user value

The host-agent marketing loop is complete, but production native UI remains gated by a real privacy-attribution defect. This remediation increases trust, reliability, and recoverability by eliminating bare shipped helper paths from the production launch chain.

## Commander's-intent posture

- **Audience:** macOS Spectra users and the host agents that invoke its native capture runtime.
- **Stakes:** high; incorrect attribution makes capture fail, creates misleading privacy rows, and erodes trust.
- **Priority order:** reliability, security, simplicity, polish, speed, cost.
- **Acceptable tradeoffs:** retain `~/.spectra/bin` only behind an explicit development helper mode during the transition.
- **Non-goals:** no automatic TCC reset, no autonomous privacy-setting change, no real-identity signing outside the existing Xcode build, no Campaign Studio code before M1 acceptance.

## Approach lenses

- **Clean-sheet best:** `SMAppService.agent(plistName:)` with bundle-owned agent plists and executables, plus in-process or XPC-owned ScreenCaptureKit work.
- **Current-constraints best:** preserve the proven two-agent socket topology while resolving both agents and every capture helper from a stable installed `Spectra.app/Contents/Helpers`, with an authoritative production environment contract and a separately explicit development fallback.
- **Bridge/backcast:** centralize helper resolution now, embed every required executable, make legacy plists app-associated, and use that stable bundle contract as the migration seam for a later `SMAppService` conversion.

## Constraints

- Preserve the public `LaunchAgentManager` lifecycle signatures, labels, sockets, and frozen API behavior.
- Keep the canonical main worktree and its unrelated build-loop dirt untouched.
- Work only on `codex/marketing-content-loop` in the isolated worktree.
- Do not add a package or external service.
- Status checks must never present a permission prompt.
- Production runtime resolution and Release packaging must fail closed when required embedded helpers are missing or non-executable; local development may fall back only when explicitly selected.
- Persistent production plists may point only at a supported stable app location, never DerivedData, staging, a mounted DMG, or another transient path.
- Single-TS rollback must keep the canonical primary socket and must not restore bare helper attribution.
- Do not mutate live TCC state until the action-time confirmation required for System Settings.

## Non-goals

- Replacing the two-agent routing topology or changing operation ownership.
- Completing the full `SMAppService` migration in this pass.
- Removing the TypeScript backend, `~/.spectra/dist`, or local helper build outputs.
- Cleaning stale privacy rows or orphan processes without user-present approval.
- Implementing Campaign Studio before attribution acceptance is proven.

## Activation gate

This remediation passes when current signed build artifacts contain all required helpers and the required privacy metadata; every plist producer executes stable bundle-contained paths and propagates an authoritative helper-mode contract; Swift and TypeScript callers never recompute a bare path; status probes are non-prompting; focused and full tests pass; installed launchd/TCC evidence identifies `dev.spectra.app`; and the remaining user-present permission/capture proof is prepared without being falsely claimed complete.
