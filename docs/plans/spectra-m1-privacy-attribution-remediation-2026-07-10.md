# Spectra M1 privacy attribution remediation plan

⚠ Plan gaps: 7 live activation checks intentionally remain for R5; `plan-verify` and the independent critic report no planning blockers.

## Governing thought

Preserve Spectra's proven daemon topology, but make a stable installed signed app bundle the authoritative production execution boundary for every TCC-sensitive process. Centralize path resolution, fail closed at runtime and in Release packaging, and preserve bare helpers only through an explicit development mode.

## Intent link

- **North star:** one trustworthy Spectra permission identity for all native capture behavior.
- **Primary workflow:** install Spectra, activate its background service, grant permissions once, capture without helper-specific recovery.
- **User-value rules:** reliability, trust, simpler recovery, and a stable foundation for the selected Campaign Studio UI.
- **Non-goals:** full `SMAppService` migration, TCC reset/grant automation, daemon contract changes, and Campaign Studio implementation before M1 acceptance.

## Current evidence

- Live System Settings shows Spectra under Accessibility but only bare helpers under Screen Recording.
- A launchd `--no-request` A/B probe maps the bare preflight path to no bundle and the embedded path to `Sub:{dev.spectra.app}`.
- Release `Spectra.app` signs correctly, but `/Applications/Spectra.app` is stale/ad hoc and lacks helpers.
- `LaunchAgentManager`, Swift daemon-core callers, and legacy scripts still select `~/.spectra/bin`.
- The TypeScript cursor-sampler path returned by its bundle-aware compiler resolver is currently discarded and replaced by a hard-coded home path.
- `window-focus.ts` independently selects the Screen Recording-dependent `spectra-window-bounds` helper under `~/.spectra/bin`.
- `project.yml` currently sweeps the standalone `DaemonCore` tree into the app target when xcodegen regenerates; its top-level `main.swift` then makes the app fail to compile.
- System-audio capture is public, but the app metadata does not yet declare `NSAudioCaptureUsageDescription`.
- The full RCA and closure evidence are in `docs/research/spectra-m1-privacy-attribution-2026-07-10.md`.

## Approach lenses

### Clean-sheet best approach

Use `SMAppService.agent(plistName:)` with two plists in `Contents/Library/LaunchAgents`, bundle-relative programs, and a capture service owned by the visible app or an embedded XPC service. This gives macOS explicit lifecycle and app ownership.

### Current-constraints approach

Keep the existing two-agent launchd topology and external TypeScript dist, but point generated legacy plists only at executables inside a stable installed app bundle. Propagate one authoritative helper-mode contract to Swift and TypeScript callers; allow `~/.spectra/bin` only when `SPECTRA_HELPER_MODE=development` is explicit.

### Bridge/backcast

The shared helper resolver and bundle-contained executable inventory become the seam for a later `SMAppService` migration. The future migration can replace registration/lifecycle without revisiting every helper caller or TCC-sensitive path.

### Recommendation

Execute the current-constraints bridge now. The existing launcher can already resolve Node and the mirrored dist when started without flags, so static arguments are not the blocker. A full `SMAppService` conversion is still more than twice this remediation because it adds registration approval state, legacy-label migration, update/re-registration behavior, and rollback/unregister semantics. Those lifecycle decisions are not needed to close today's attribution defect.

### Path A vs Path B — background service registration

**Path A (selected bridge):** keep generated legacy plists, execute embedded helpers from `/Applications/Spectra.app` or `~/Applications/Spectra.app`, add `AssociatedBundleIdentifiers`, and verify TCC attribution. This preserves the current public lifecycle and rollback surface.

**Path B (durable target):** migrate registration to `SMAppService.agent(plistName:)` and bundle static plists under `Contents/Library/LaunchAgents`.

**Gates check:**

- Time-budget greater than 2x Path A: yes; Path B requires registration-state migration, update behavior, and a tested rollback path.
- Missing dependency or infrastructure: no external dependency, but new bundle resources and service registration state are required.
- Missing design decision: yes; decide whether a future service migration also internalizes Node/dist or keeps the launcher's current external fallback.
- Foreclosed-future list empty: no; Path B improves move/update registration and Login Items ownership.

**Recommendation:** Path A for this defect-remediation pass, with the resolver/environment seam deliberately shaped for Path B.

### Path A vs Path B — helper resolution

**Path A:** duplicate bundle/development logic independently in BridgeClient and RecordingOps.

**Path B:** add one small Foundation-only `BundleHelperPaths` module used by AX, recording, cursor, and tests.

**Gates check:** Path B is less than 2x, needs no dependency or product decision, and directly prevents drift across named capture surfaces.

**Recommendation:** Path B.

## Depends-on (reads-from)

- `Bundle.main.bundleURL/Contents/Helpers` — valid only when the visible app is running from a supported stable location; standalone daemon-core must use authoritative plist environment or derive from its own embedded executable path.
- `SPECTRA_HELPER_MODE=bundle|development` — new locked mode contract; bundle is authoritative/fail-closed, development permits the home build outputs.
- `SPECTRA_APP_BUNDLE_HELPERS_DIR` — verified; LaunchAgentManager and legacy script templates will write it.
- `SPECTRA_APP_BUNDLE_PATH` — verified; LaunchAgentManager and legacy script templates will write it.
- `SPECTRA_NATIVE_HELPER_PATH`, `SPECTRA_CURSOR_SAMPLER_PATH`, and `SPECTRA_WINDOW_BOUNDS_BIN` — verified existing override seams or planned locked paths; every plist producer will write them.
- `~/.spectra/bin` development fallback — verified; existing native build scripts write these binaries.
- `~/.spectra/dist/cli/index.js` — verified; `scripts/postinstall.sh` and `scripts/sync-dist.sh` write the mirrored TypeScript dist.
- labels `dev.spectra.daemon` and `dev.spectra.daemon-ts` — verified; current manager, scripts, tests, and launchd evidence use them.
- primary and secondary socket paths — verified; current manager, daemon server, and routing tests own them.

## Capability Gap Map

| Capability | Current source of truth | Target behavior | Gap | Build action | Owned files/contracts | Validation |
|---|---|---|---|---|---|---|
| Agent executable attribution | manager + flip/install/rollback plist authors | Production agents execute inside a stable Spectra.app | Bare or transient paths | stable-location manager/templates + app association | Swift manager, three scripts | behavioral plist harness + launchctl print |
| Runtime helper selection | compiler.ts, BridgeClient, RecordingOps | Bundle mode is authoritative; development mode is explicit | partial/missing bundle silently falls home | shared strict resolver + mode/env propagation | Swift + TS runtimes | missing/non-executable/moved-path tests |
| Cursor sampler execution | core-impl + compiler.ts | Spawn the path returned by bundle-aware ensure logic | ensured path is discarded; a home path is recomputed | Thread resolved path into sampler spawn | TS daemon | focused Vitest path assertion |
| Window-bounds execution | window-focus + native helper | Spawn a bundle-owned Screen Recording helper | direct home-path default | route through locked helper resolver | TS pipeline | focused runner-path assertion |
| Release helper inventory | macos/Makefile + build-and-refresh | All required helpers present or release fails | daemon-core and text-render omitted; missing helpers skipped | Add both, prebuild, strict release mode | Makefile/build script | built bundle inventory + codesign |
| Xcode target isolation | project.yml + generated xcodeproj | App target excludes standalone DaemonCore main/resources | broad source glob breaks regenerated builds | explicit exclusion + resolver test-only membership | project.yml/xcodeproj | clean temp xcodegen + xcodebuild |
| Permission status | core-impl + composite-worker | Status reads never prompt | helpers invoked without `--no-request` | pass explicit flag + regression tests | TS daemon | focused Vitest |
| System-audio metadata | project.yml + Info.plist | Built app has a clear system-audio purpose string | key absent | add and inspect built metadata | native app metadata | built Info.plist test |
| Rollback attribution | rollback-g1 single TS primary topology | Preserve primary socket while using bundle launcher/helpers | current rollback restores bare launcher | switch attribution only; no listen override | rollback script | behavioral plist harness |
| M1 proof | System Settings/TCC/runtime capture | Spectra row + app subject + real capture | grant and installed build pending | prepare build and user-present proof | runtime evidence only | TCC logs, panes, capture |

## Activation Map

- `LaunchAgentManager.install/bootstrap` — trigger: native app `SpectraViewModel.activateDaemon()` — automated: M1-A manager cases; verified-live: pending R5 native activation.
- `scripts/flip-g1.sh` front/backend — trigger: explicit operator flip — automated: M1-A fake-launchctl harness; verified-live: pending R5 only if this operator path is exercised.
- `scripts/install-daemon.sh` single TS primary — trigger: explicit operator install — automated: M1-A fake-launchctl harness; verified-live: pending.
- `scripts/rollback-g1.sh` single TS primary — trigger: explicit operator rollback — automated: M1-A fake-launchctl harness including absence of `SPECTRA_DAEMON_LISTEN_SOCKET`; verified-live: pending.
- bundle helper embedding + Release strictness — trigger: Xcode post-build phase — automated: M1-B complete/missing inventory cases; verified-live: pending signed build.
- non-prompting status probes — trigger: daemon permission status/composite preflight — automated: M1-C exact spawn arguments; verified-live: pending current installed daemon.
- cursor/window-bounds bundle routing — trigger: recording/polish entry points — automated: M1-E exact runner paths; verified-live: pending current installed helper exercise.

Every pending row maps to a named automated probe and, where production state matters, the installed-path R5 proof.

## UI Input/Output Contract

No production UI changes are allowed in this plan. The existing permission panel remains the visible prompt owner. Inputs are user clicks on existing permission actions; outputs are current permission status and recovery copy. The selected Campaign Studio mockup is tracked separately and remains gated by M1 acceptance.

## Single-Shot Build Guardrails

| Guardrail | Failure prevented | Evidence |
|---|---|---|
| Production plist has no bare helper program | TCC creates helper/path identities | LaunchAgentManager XCTest + script static assertions |
| Bundle mode never falls through when a helper is missing/non-executable | partial bundle silently recreates bare TCC subjects | Swift/TS negative resolver cases |
| Persistent plist accepts only a stable app location | launchd persists DerivedData, staging, or mounted-DMG paths | manager/shell stale-location tests |
| Release packaging requires complete helper inventory | signed app silently ships incomplete | strict `embed-helpers` build and bundle inventory check |
| One resolver owns Swift helper precedence | AX and recording diverge again | BundleHelperPaths tests + caller grep |
| Cursor sampler receives the ensured executable path | TS silently bypasses bundle resolution | focused spawn-argument Vitest |
| Window-bounds receives the authoritative bundle path | polish/focus path creates another Screen Recording identity | focused runner-path Vitest |
| xcodegen excludes the standalone DaemonCore target tree | regenerated app target gains a second main | clean temp regeneration + app build |
| Status probes pass `--no-request` | background status read presents prompt | focused Vitest argument assertions |
| Built app declares system-audio purpose | audio capture prompts without product-owned explanation | Info.plist build assertion |
| Rollback keeps single TS primary-socket semantics | privacy fix changes emergency recovery behavior | fake-launchctl/plist behavioral harness |
| No real signing identity is selected by helper build scripts | unattended keychain/signing side effect | helper builds remain ad hoc; Xcode re-signs nested binaries |
| Frozen contract files remain byte-identical | privacy fix drifts API behavior | git diff guard + conformance/full tests |
| M1 acceptance stays open without live proof | implementation green misreported as usable capture | Rally acceptance blocker + explicit R5 result |

## Read-Before-Edit Map

| Work item | Read first | Why | Edit after |
|---|---|---|---|
| R1 resolver | BridgeClient, RecordingOps, existing env overrides and daemon-core build scripts | preserve precedence and create real test coverage outside the app target | BundleHelperPaths + Swift callers/tests |
| R2 manager | LaunchAgentManager, SpectraViewModel caller, manager tests | keep public lifecycle and two-agent behavior | manager + tests |
| R3 packaging/scripts | Makefile, project.yml, generated project, build-and-refresh, install/flip/rollback scripts | cover every plist/build author, target boundary, stable-location rule, and signing guardrail | packaging, generated project, legacy templates/tests |
| R4 TS native runtime | core-impl, composite-worker, compiler resolver, window-focus, bootstrap, focused tests | preserve status semantics and actually consume strict bundle cursor/window paths | TS implementations/tests |
| R5 validation | RCA closure gate, native migration acceptance, current build scripts | use real boundary evidence | evidence/Rally only; no TCC mutation without confirmation |

## Dependency graph and execution

```text
R0 plan
├── R1 shared Swift resolver
├── R4 TypeScript non-prompting probes + cursor path propagation
└── R2 manager + R3 packaging/scripts (R2 contract first)
         └── R5 integrated build + launchd/TCC proof
```

parallel_batch: R1-resolver, R4-ts-native-runtime, R2-manager-readiness

Integration checkpoint: after parallel work returns, the lead reviews the shared environment names, applies packaging/scripts against that locked contract, then runs all focused suites together before any commit.

## MECE ownership packets

### R1 — Swift helper resolver

- **Dimension:** runtime adapter.
- **Owns files:** `macos/Spectra/DaemonCore/BundleHelperPaths.swift`, `BridgeClient.swift`, `RecordingOps.swift`, `macos/SpectraTests/BundleHelperPathsTests.swift`, and `tests/macos/bundle-helper-paths-contract.sh`.
- **Does not own:** LaunchAgentManager, packaging, scripts, TypeScript daemon, UI.
- **Interface contract:** explicit helper override is authoritative; `SPECTRA_HELPER_MODE=bundle` requires the configured helper directory and never falls through; only `SPECTRA_HELPER_MODE=development` may use `~/.spectra/bin`. Missing/non-executable configured paths remain visible failures.
- **Integration checkpoint:** daemon-core Swift build + standalone resolver contract + focused XCTest; caller grep shows no independent production path logic. R3 owns explicit test-target membership without app-target DaemonCore membership.
- **Intent link:** one app identity across AX, recording, and cursor operations.
- **Acceptance criteria:** M1-D passes for override, bundle, development, missing, non-executable, and moved/stale cases; all existing specific override seams remain authoritative.

### R2 — Native LaunchAgent manager

- **Dimension:** lifecycle adapter.
- **Owns files:** `macos/Spectra/Daemon/LaunchAgentManager.swift`, `macos/SpectraTests/LaunchAgentManagerTests.swift`.
- **Does not own:** helper resolver internals, scripts, packaging, UI.
- **Interface contract:** lifecycle method signatures, labels, socket topology, backend-first bootstrap, and explicit dev mode remain stable. Production accepts only a stable app bundle, validates core/launcher before writing either plist, and propagates the locked bundle env contract.
- **Integration checkpoint:** focused manager tests and generated plist inspection.
- **Intent link:** app-owned background service attribution.
- **Acceptance criteria:** M1-A manager cases pass; both plists contain app association and embedded program/env paths; transient/moved/missing paths write neither plist.

### R3 — Packaging and legacy operators

- **Dimension:** delivery/operations.
- **Owns files:** `macos/Makefile`, `macos/project.yml`, `macos/Spectra.xcodeproj/project.pbxproj`, `macos/Spectra/Info.plist`, `scripts/build-and-refresh.sh`, shared shell resolver if introduced, `scripts/install-daemon.sh`, `scripts/flip-g1.sh`, `scripts/rollback-g1.sh`, `tests/macos/launch-agent-contract.sh`, `tests/macos/helper-packaging-contract.sh`, `tests/macos/xcodegen-target-isolation.sh`, and `tests/macos/info-plist-privacy-contract.sh`.
- **Does not own:** Swift runtime call sites, TypeScript daemon, UI, TCC state.
- **Interface contract:** Xcode remains the final nested-code signer; helper prebuild stays ad hoc; development fallback is explicit; Release embedding itself is strict; `DaemonCore/**` is excluded from the app target while `BundleHelperPaths.swift` may be compiled into the test target explicitly. Flip remains dual-agent primary/secondary; install/rollback remain single-TS primary with no listen override. Production paths must be stable and complete before any plist write.
- **Integration checkpoint:** fake-launchctl behavioral harness for manager-independent templates, shell syntax, complete/missing helper packaging cases, regenerated tracked project review/build, ad-hoc app inventory, built Info.plist, and codesign verification.
- **Intent link:** prevent incomplete, wrongly targeted, or externally launched production artifacts.
- **Acceptance criteria:** M1-A, M1-B, M1-F, and M1-G pass; all four plist surfaces use the same mode/path contract; the helper set includes daemon-core and text-render; rollback socket semantics are unchanged.

### R4 — TypeScript native-helper runtime

- **Dimension:** TypeScript helper resolution and process boundaries.
- **Owns files:** `src/native/compiler.ts`, `src/daemon/core-impl.ts`, `src/daemon/composite-worker.ts`, `src/pipeline/window-focus.ts`, `src/client/bootstrap.ts` only if strict-mode compatibility requires it, `tests/native/compiler.test.ts`, `tests/daemon/permission-probe.test.ts`, `tests/daemon/composite-preflight.test.ts`, `tests/daemon/core.test.ts`, `tests/pipeline/window-focus.test.ts`, and `tests/daemon/privacy-helper-routing.test.ts`.
- **Does not own:** contract schemas, helper Swift source, manager, packaging, UI.
- **Interface contract:** permission states/errors stay byte-compatible; status paths pass `--no-request`; bundle mode is authoritative/fail-closed; development mode preserves compile/home behavior; exact cursor and window-bounds resolved paths reach their process runners.
- **Integration checkpoint:** focused Vitest, build, contract diff guard.
- **Intent link:** truthful status and one app-owned identity across every TS-launched native helper.
- **Acceptance criteria:** M1-C and M1-E pass; compiler tests cover all ensure functions and partial bundles; focused tests assert exact preflight arguments plus cursor/window executable paths; direct bootstrap stays compatible.

### R5 — Integration and evidence

- **Dimension:** verification.
- **Owns files:** `docs/research/spectra-m1-privacy-attribution-2026-07-10.md` factual closure section and Rally facts only; lead-only.
- **Does not own:** new features or UI.
- **Interface contract:** implementation pass is distinct from acceptance pass; any new code/test defect routes back to R1–R4 rather than being silently fixed in R5.
- **Integration checkpoint:** commands below plus Rally fact update.
- **Intent link:** do not trade user trust for a compile-only completion claim.
- **Acceptance criteria:** all automated gates green; user-present actions identified precisely.

## Synthesis dimensions

```yaml
synthesis_dimensions:
  - service_registration_strategy: legacy-plist bridge now, SMAppService target later
  - helper_path_precedence: authoritative specific override, authoritative configured bundle, stable installed app, explicit development home
  - fallback_policy: bundle mode fails closed at runtime and packaging; home only in development mode
  - permission_prompt_owner: visible app only
  - signing_boundary: ad-hoc prebuild, Xcode final nested signing
  - persistent_location: Applications or user Applications only in production
  - rollback_topology: single TypeScript daemon on primary socket, bundle launcher/helpers
```

## Validation matrix

1. `python3 <build-loop>/scripts/acceptance_probe.py classify --goal .build-loop/goal.md --json`
2. Run M1-A through M1-G directly; this exercises all plist producers, complete/missing Release inventory, Swift production/development resolution, exact TypeScript spawn paths/arguments, regenerated target isolation, and built privacy metadata.
3. `npx vitest run --no-file-parallelism tests/native/compiler.test.ts tests/daemon/permission-probe.test.ts tests/daemon/composite-preflight.test.ts tests/daemon/core.test.ts tests/daemon/privacy-helper-routing.test.ts tests/pipeline/window-focus.test.ts`
4. Regenerate the tracked project from `macos/project.yml`, review the exact pbxproj delta, verify `DaemonCore/main.swift` is absent from the app target and `BundleHelperPaths.swift` is test-only, then run `xcodebuild -project macos/Spectra.xcodeproj -scheme Spectra -destination 'platform=macOS' -derivedDataPath /tmp/spectra-m1-remediation-derived CODE_SIGNING_ALLOWED=NO test` against that regenerated project.
5. `bash scripts/build-daemon-core.sh`, the focused native/daemon-core verification suites, then isolated `npx tsc --noEmit` and `npm test` with helper environment controlled.
6. `bash -n scripts/build-and-refresh.sh scripts/install-daemon.sh scripts/flip-g1.sh scripts/rollback-g1.sh` and the fake-launchctl harness; inspect manager, flip front/backend, install single-TS, and rollback single-TS plist outputs separately.
7. Run the ad-hoc Release packaging path with the full helper prebuild. Assert core, launcher, native, composite, preflight, cursor, window-bounds, and text-render are executable; inspect built `NSAudioCaptureUsageDescription`; verify nested/outer signatures appropriate to build mode. Also run the one-helper-missing negative case.
8. Before live mutation, verify the prepared app path is exactly `/Applications/Spectra.app` or `~/Applications/Spectra.app`; reject DerivedData, staging, mounted-DMG, or moved paths. Validate both plists before writing either.
9. With action-time confirmation, install/current-launch the signed app through the native UI, inspect both `launchctl print` records and primary/secondary socket variables, then invoke permission status, AX/native capture, cursor capture, composite preflight/capture, and window-bounds. Correlate each TCC log to `Sub:{dev.spectra.app}` and assert no new bare-path subject.
10. Relaunch the installed app and run one real non-black playable capture with system audio behavior covered by the declared purpose string. Record screenshots/log/capture evidence in the RCA and resolve Rally acceptance only if all live gates pass.
11. `git diff --exit-code 61f591d -- src/contract/contract.snapshot.json src/contract/contract.spec.json` for this remediation commit range.

## Commit plan

1. **R0 — `docs(plan): scope native privacy attribution remediation`**
2. **R1/R2 — `fix(macos): resolve daemon helpers from signed app bundle`**
3. **R3/R4 — `fix(macos): enforce complete bundle packaging and non-prompting probes`**
4. **R5 — `test(macos): prove bundled privacy attribution contract`** if validation needs additional test/evidence changes.

## Exit conditions

- Do not implement Campaign Studio in this run unless the M1 acceptance blocker is resolved with live pane and capture evidence.
- Do not alter privacy settings, reset TCC, terminate stale processes, replace `/Applications/Spectra.app`, or select a signing identity without the relevant action-time authority.
- Do not merge or push; this branch remains the isolated integration surface unless the user separately requests publication.
