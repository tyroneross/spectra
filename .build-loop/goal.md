<!-- goal_run_id: bl-spectra-m1-attribution-20260710 -->
# Goal — Spectra M1 privacy attribution remediation

## Goal

Ship and verify a backward-compatible production bundle contract that makes the installed native Spectra app the responsible macOS privacy identity for its daemon and every Screen Recording/Accessibility helper. Production bundle configuration is authoritative and fail-closed; `~/.spectra/bin` remains available only through an explicit development mode. The current daemon API, labels, sockets, and rollback topology remain stable.

## Scoring criteria

1. **Bundle-owned launch chain** — every production LaunchAgent producer executes daemon-core/daemon-launcher under a stable `Spectra.app/Contents/Helpers`, propagates the same helper-mode contract, and associates with `dev.spectra.app`.
2. **Strict production, explicit development** — `SPECTRA_HELPER_MODE=bundle` never falls through to a home binary when a configured helper is missing, non-executable, stale, or moved; `SPECTRA_HELPER_MODE=development` preserves the current local fallback.
3. **Complete signed packaging** — Release embeds exactly daemon-core, text-render, and every required helper; copy/sign failures and missing or architecture-incompatible helpers fail the build; the app and helpers cover arm64 and x86_64, retain hardened runtime, and share the requested signing identity; the generated app target excludes the standalone DaemonCore entry point.
4. **Shared deterministic resolution** — Swift AX/recording and TypeScript native/cursor/window-bounds callers consume resolved executable paths with the same override/bundle/development precedence.
5. **Non-prompting status and complete privacy metadata** — status-only Screen Recording probes always pass `--no-request`, the visible app remains the prompt owner, and the built app declares a system-audio capture purpose string.
6. **Compatibility and rollback safety** — labels, sockets, public lifecycle signatures, wire/API contracts, backend-first dual-agent activation, and single-TS primary-socket rollback behavior remain stable.
7. **Real attribution evidence** — a current signed app installed at a supported stable location resolves all relevant TCC work to `dev.spectra.app`; pane grants and a non-black playable capture remain explicitly open until performed with the user present.

```acceptance_probe
[
  {
    "id": "M1-A",
    "criterion": "All LaunchAgent producers emit the intended bundle programs, app association, helper environment, labels, and socket topology",
    "acceptance_probe": "if test -x tests/macos/launch-agent-contract.sh; then tests/macos/launch-agent-contract.sh; else printf 'missing-launch-agent-contract-test\\n'; fi",
    "baseline": "missing-launch-agent-contract-test",
    "boundary": "data",
    "defect_class": true
  },
  {
    "id": "M1-B",
    "criterion": "Release helper embedding fails on missing, unsafe, or failed copy/sign inventory and the built app has exact universal helpers with hardened, mode-correct outer/nested signatures",
    "acceptance_probe": "if test -x tests/macos/helper-packaging-contract.sh && test -x tests/macos/release-bundle-contract.sh; then tests/macos/helper-packaging-contract.sh && tests/macos/release-bundle-contract.sh \"${SPECTRA_RELEASE_APP_PATH:-$PWD/Spectra.app}\"; else printf 'missing-helper-packaging-contract-test\\n'; fi",
    "baseline": "missing-helper-packaging-contract-test",
    "boundary": "data",
    "defect_class": true
  },
  {
    "id": "M1-C",
    "criterion": "Status-only Screen Recording calls pass --no-request at every TypeScript spawn boundary",
    "acceptance_probe": "if test -f tests/daemon/privacy-helper-routing.test.ts; then npx vitest run --no-file-parallelism tests/daemon/privacy-helper-routing.test.ts -t 'passes --no-request'; else printf 'missing-non-prompting-probe-test\\n'; fi",
    "baseline": "missing-non-prompting-probe-test",
    "boundary": "console",
    "defect_class": true
  },
  {
    "id": "M1-D",
    "criterion": "Swift helper resolution is bundle-authoritative in production and home-fallback only in development",
    "acceptance_probe": "if test -x tests/macos/bundle-helper-paths-contract.sh; then tests/macos/bundle-helper-paths-contract.sh; else printf 'missing-bundle-helper-resolver-test\\n'; fi",
    "baseline": "missing-bundle-helper-resolver-test",
    "boundary": "console",
    "defect_class": true
  },
  {
    "id": "M1-E",
    "criterion": "TypeScript cursor and window-bounds spawns consume bundle-authoritative resolved paths",
    "acceptance_probe": "if test -f tests/daemon/privacy-helper-routing.test.ts; then npx vitest run --no-file-parallelism tests/daemon/privacy-helper-routing.test.ts -t 'routes cursor and window-bounds'; else printf 'missing-native-helper-routing-test\\n'; fi",
    "baseline": "missing-native-helper-routing-test",
    "boundary": "console",
    "defect_class": true
  },
  {
    "id": "M1-F",
    "criterion": "A freshly generated Xcode project excludes DaemonCore/main.swift from the Spectra app target and builds the intended targets",
    "acceptance_probe": "if test -x tests/macos/xcodegen-target-isolation.sh; then tests/macos/xcodegen-target-isolation.sh; else printf 'missing-xcodegen-target-isolation-test\\n'; fi",
    "baseline": "missing-xcodegen-target-isolation-test",
    "boundary": "console",
    "defect_class": true
  },
  {
    "id": "M1-G",
    "criterion": "The built application declares a non-empty system-audio capture purpose string",
    "acceptance_probe": "if test -x tests/macos/info-plist-privacy-contract.sh; then tests/macos/info-plist-privacy-contract.sh; else printf 'missing-info-plist-privacy-test\\n'; fi",
    "baseline": "missing-info-plist-privacy-test",
    "boundary": "data",
    "defect_class": true
  }
]
```

## Pass conditions

- **Implementation pass:** M1-A through M1-G no longer return their baselines; focused tests, daemon-core/native tests, regenerated-Xcode-project build, full TypeScript suite, contract freeze guard, and bundle inventory/signature checks are green.
- **Acceptance pass:** implementation pass plus current stable `/Applications/Spectra.app` launchd records, TCC logs, both privacy panes, helper-route exercises, relaunch, and a real non-black playable capture are green on the required OS.
- **Partial:** implementation is green but a user-present privacy action or macOS 26.1 host remains outstanding. Partial must not be reported as M1 accepted.
- **Fail:** any shipped path falls back to a bare helper, status checks can prompt, strict Release packaging can omit a helper, xcodegen changes the executable target boundary, system-audio metadata is absent, socket/rollback behavior changes, or existing daemon behavior regresses.
