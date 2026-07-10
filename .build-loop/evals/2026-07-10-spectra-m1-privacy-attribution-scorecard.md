Spectra's production helper chain is implementation-ready; installed-app privacy acceptance remains open.

# Spectra M1 privacy-attribution remediation scorecard

## Outcome

Implementation pass is complete. M1 acceptance remains partial until the current Apple-signed app is installed at a supported stable path and the user-present privacy, TCC attribution, relaunch, and real-capture checks pass.

## Done

- ✅ Production LaunchAgent producers use stable bundle programs, bundle association, explicit helper paths, preserved labels/sockets, and fail before writes on unsafe inventory. [`tests/macos/launch-agent-contract.sh` → manager + install/flip/rollback contract]
- ✅ Swift and TypeScript helper resolution rejects missing, non-executable, empty, moved, or symlink-escaped production paths; only explicit development mode may use home helpers. [XCTest + Vitest → 76 macOS tests and 966 TypeScript tests]
- ✅ Status-only Screen Recording probes pass `--no-request`; the visible app remains the only prompt owner. [`tests/daemon/privacy-helper-routing.test.ts` → 3 focused tests]
- ✅ Release packaging contains exactly eight universal helpers, stops on copy/sign failures, preserves hardened runtime, and validates requested signing mode plus signer/team parity before replacing artifacts. [`npm run build:dmg:adhoc` + `tests/macos/release-bundle-contract.sh` → app and DMG]
- ✅ The app target excludes standalone DaemonCore and internal porting notes, while the built Info.plist contains the system-audio purpose string. [xcodegen isolation + Info.plist contract → built app]
- ✅ Frozen daemon wire/API contracts are unchanged. [`git diff --exit-code` → contract snapshots]
- ✅ Independent adversarial review is clear with no open critical or high findings. [independent-auditor recheck → YAY]
- ✅ Privacy/fact scan found no secrets, private runtime data, or production mock behavior. [full changed-file scan → clear]

## Validation

- M1-A through M1-G: pass.
- `npm test`: 87 files; 966 passed, 2 skipped.
- Xcode: 76 passed, 0 failed.
- Ad-hoc Release + DMG: pass; app and all helpers are `arm64 + x86_64`.
- Rosetta x86_64 no-request preflight: exit 0.
- TypeScript typecheck, regenerated project, shell syntax, ShellCheck, package dry run, contract freeze, and `git diff --check`: pass.
- Runtime-server smoke: skipped because the project exposes no HTTP/SSE runtime adapter; Release helper and socket-boundary contracts supplied the runtime evidence.
- Pytest collect: skipped because the repository has no Python test suite.
- Architecture orphan scan: skipped because `.navgator/architecture/index.json` is absent.
- README currency: pass.
- Version advisor: hold at 0.4.0; no release marker and no push requested.

## Held

- Apple-signed build and `/Applications/Spectra.app` replacement require action-time approval because they use a user signing identity and alter the installed app.
- Privacy panes, TCC log attribution to `dev.spectra.app`, relaunch, helper-route exercise, and a playable non-black capture require the user-present installed-app session.
- Required-host acceptance is not complete on this machine because it currently runs macOS 26.0.1 rather than the specified 26.1 target.
- Aurora Glass Campaign Studio production UI remains gated on M1 live acceptance.

## Notes from judges

- `independent_review_required: true`; result: YAY.
- `cross_vendor_required: true`; result: untested because Rally reports no managed peer sessions.
- `[Simplify] 3 hotspots, 1 applied, 2 advised`: consolidated mode-aware Release validation; deferred extraction of the long Make recipe and a single generated helper manifest because those are broader refactors outside this remediation gate.
- No deployment, push, merge, version bump, live permission change, or `/Applications` mutation occurred.

## Learn

Learn: accruing (1/3 runs). Detector scanned 0 prior recorded runs and found no recurring pattern; no experimental artifact was created.

parallel_batch: three independent read-only review/detection lanes covered implementation safety, privacy/fact consistency, and recurrence signals.

merge_plan:
  clean_against: `origin/main@f3129c8` at branch creation; implementation is isolated in `codex/marketing-content-loop`.
  conflicts_with: the primary `spectra` main worktree contains unrelated dirty files and is not safe for an automatic merge.
  suggested_order: commit this branch, complete the user-present M1 gate, implement and validate Aurora Glass Campaign Studio, then re-audit branches and merge intentionally.
