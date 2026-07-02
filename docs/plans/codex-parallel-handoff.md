# Codex parallel handoff — Spectra native-Swift migration

**What this is:** a self-contained work package for Codex to execute three independent workstreams (M1 GUI-verify, M4 CDP port, M5 polish-orchestration port) in parallel with the Claude/Fable side, which is finishing M2B (the parity oracle) and owns M3 (the strangler cutover). This doc does not itself post to rally — the orchestrator pastes the "ready-to-post" section at the bottom into `rally say handoff`.

**Source docs (read before starting any arm):**
- `docs/plans/native-swift-migration-RESUME.md` — current state, guardrails, hand-off rationale
- `docs/plans/native-swift-migration.md` — full plan; M1/M4/M5 milestone tables + dependency graph (§"Dependency graph", lines ~163-178)

**Ownership split:**
| Owner | Scope |
|---|---|
| **Claude/Fable** | M2B parity oracle (`tests/conformance/**`, `tools/dual-run/**`, `src/contract/**` spec-export), all orchestration/judging (Fable verdicts), M3 strangler cutover (`macos/Spectra/DaemonCore/**`, `macos/Spectra/Daemon/LaunchAgentManager.swift`, `src/daemon/**` read-only-frozen) |
| **Codex** | M1 GUI-verify (build/sign/notarize + on-device privacy-pane check), M4 Swift CDP port (new `macos/Spectra/CDP/**`), M5 Swift pipeline port (new `macos/Spectra/Pipeline/**`) |

**Critical-path reminder:** `M2B → M3.G1 → M3.G2 → M3.G3 → M3.G4 → M5-retirement → M6`. M3.G3 (web capture) blocks on **M4** landing + accepted; M3.G4 (demo/polish) blocks on **M5-port** landing + accepted. M4 ∥ M5 ∥ M2B are all parallelizable against each other (disjoint files) but **no M3 group flips until M2B is committed** — Codex's M4/M5 output sits in isolated worktrees ready to merge, not blocking or blocked by M2B directly. M1 is fully independent of all of the above (only needs the already-committed M1 code milestone `104e362`).

---

## Model/tier guidance

Per `build-loop-memory/model-selection/fan-out-orchestration-policy.md`: decompose by determinism first, fan only the judgment that's left, and for **write-shape fans use worktree-per-agent (MECE-disjoint ownership), then integrate → test → fast-forward** — not shared-state edits. M4 and M5 are exactly this shape: run each as an isolated-worktree arm (Codex, and optionally Sonnet/Opus variants per `model-usage-fable-vs-opus.md`'s A/B pattern) with **no shared files between arms**, then the Claude/Fable side runs a **code-review-verifiable** merge decision — per `model-selection/README.md` §2, bounded/well-specified execution work sits at the "tier ≈ 0 effect" end (README §4.6: "Objective coder DoE: all 18 cells = 1.000. Use the cheapest model there"), so a single well-specced Codex arm per milestone is sufficient; only add parallel Sonnet/Opus A/B arms if Codex's first pass fails acceptance criteria or the orchestrator wants a bake-off. Winner selection is **not** self-graded — Fable (or the orchestrator) renders the verdict against the acceptance criteria below, same as every other milestone gate in the plan (`native-swift-migration.md` §"Verification strategy" item 8: "no milestone... closes... without a Fable verification verdict").

---

## MANDATORY guardrails — embed verbatim in every arm

1. **Never delete a dir/file you didn't create.** No `rm`/`rmSync` of non-owned paths. `.spectra/` is PROTECTED real data — a prior subagent `rmSync`'d the repo's real `.spectra/` (226 sessions/50 recordings) thinking it was junk; unrecoverable. Do not touch `.spectra/` at all in these arms.
2. **Isolate storage to a temp root** for any test/probe that could write captures — set a temp `HOME`/`SPECTRA_HOME` before running anything that exercises capture or daemon storage; never let `storage.ts` (or its Swift equivalent) resolve to the repo's real `.spectra`.
3. **Keychain-safe.** Ad-hoc codesign is the default (`SPECTRA_CODESIGN_IDENTITY` opt-in only, and only when the user explicitly supplies their Apple identity — never auto-sign with a real identity). Chrome launches with `--password-store=basic --use-mock-keychain`. Never trigger the macOS login keychain.

---

## Per-arm spec

### Arm 1 — M1 GUI-verify

**Goal:** Prove the already-committed M1 code (`104e362`) produces a real, signed `Spectra.app` that macOS 26.1 recognizes for Screen Recording + Accessibility, and that capture-from-bundle actually works. This is verification of existing code, not new feature work — the M1 milestone table (`native-swift-migration.md` M1 row, "Acceptance") specifies exactly this on-device check, deferred at commit time because CC bash cannot drive a GUI session.

**Owned files/paths:** None expected to change under normal conditions. If the build surfaces a real defect, the fix surface is narrowly `macos/project.yml`, `macos/Makefile`, `macos/ExportOptions.plist`, or `macos/Spectra/**` (existing files only — no new targets). Do not touch `native/swift/**` build scripts in `package.json` beyond what's needed to make the existing `build:dmg` / `build:dmg:adhoc` targets succeed.

**Worktree setup:** GUI verification does not need worktree isolation — this arm runs against the live checkout because signing/notarization tooling and TCC state are host-scoped, not git-scoped. Work directly on `main` (or a short-lived branch `codex/m1-gui-verify` pushed and PR'd) — coordinate via rally before starting so no peer is mid-build on `macos/`.

**Signing constraint (hard gate):** Signing REQUIRES the user's real Apple Developer identity (team `Q6TB8685V9`). Codex drives `npm run build:dmg` (ad-hoc) to prove the build compiles and produces a `.app`; if a *real* notarized build is required for the privacy-pane check, Codex prepares everything up to the signing step and the **user** performs/approves the actual `codesign --sign "<identity>"` / notarization step. Never set `SPECTRA_CODESIGN_IDENTITY` to a real identity autonomously.

**Acceptance/test criteria (on-device-verifiable, not compile-green):**
- `xcodebuild` succeeds on **every** target in `macos/Spectra.xcodeproj` (XcodeGen gotcha from the plan: compile ALL targets, watch for SourceKit ghosts on newly-added files) — evidence: build log, not "should compile."
- `.app` appears in **System Settings → Privacy & Security → Screen Recording** and **→ Accessibility** on macOS 26.1, attributed to `dev.spectra.app` (not a stale bare-binary entry).
- A real capture (screenshot or short recording) taken via the bundled app succeeds and produces non-black, non-empty output.
- Full `vitest` suite still green (TS-internal regression check only — not a parity claim).
- XCTest smoke passes for each re-homed module under `macos/Spectra/**`.

**Standards:** No claim of "works" without the on-device screenshot/log evidence above — this is the exact gap the RESUME doc flags ("M1 deferred to a GUI pass"). Report status with ✅/⚠️/❓ per check, not a blanket pass.

**Expected outcome/artifact:** A written verification report (checklist above, each item ✅/⚠️/❓ with evidence — screenshot of the privacy pane, build log excerpt, capture file path) attached to the rally handoff response. No code changes expected unless a real defect is found.

**Guardrails:** guardrails 1–3 above apply; guardrail 3 is the operative one here (ad-hoc default, real-identity signing is user-gated).

---

### Arm 2 — M4: CDP web-capture port to Swift

**Goal:** Port the hand-rolled CDP client (`src/cdp/`, 951 LOC across 11 files: `accessibility.ts`, `browser.ts`, `connection.ts`, `console.ts`, `dom.ts`, `driver.ts`, `input.ts`, `page.ts`, `runtime.ts`, `target.ts`, `wait.ts`) to Swift — WebSocket + the DevTools domains currently used — driving **real system Chrome** (not WKWebView), launched with `--password-store=basic --use-mock-keychain` (already the pattern in `src/cdp/browser.ts`). This feeds M3 group G3 (web-capture ops); **it does not flip the routing table itself** — that's M3, Claude-owned.

**Owned files/paths:** NEW `macos/Spectra/CDP/**` only. `src/cdp/**` is **read-only** — the reference implementation Codex ports from, retained until M5 retirement (Claude-gated, later). Do not edit anything under `src/`, `tests/`, `macos/Spectra/Daemon/`, `macos/Spectra/DaemonCore/` (does not exist yet — Claude-owned when it lands).

**Worktree setup:**
```bash
cd /Users/tyroneross/dev/git-folder/spectra
git worktree add ../spectra-m4-cdp -b codex/m4-cdp-port main
cd ../spectra-m4-cdp
```
❓ Note: this repo already has rally worktrees at `.rally/worktrees/codex-01/02/03` (branches `rally/codex-01..03`) — verified 83-89 commits behind `main` and holding unrelated, already-merged composite-capture work. Do **not** reuse those stale worktrees for M4; create a fresh one as above (or let rally's own worktree-claim flow assign a new one — the orchestrator handles that, not this doc).

**Acceptance/test criteria:**
- Conformance suite (once M2B lands) green for web-capture ops against the Swift daemon — ❓ M2B is not yet committed at hand-off time, so this specific check is **blocked** until Claude's side lands it; M4 can and should proceed on the criteria below in the meantime.
- Live capture of a real Chrome session on macOS 26.1 (navigate, screenshot, DOM query) — code-review + on-device evidence, not just "compiles."
- Protocol edge cases from the plan's R2 risk note handled: target attach/detach, OOPIF (out-of-process iframes), flaky WebSocket lifecycle/reconnect.
- XCTest coverage per ported module.
- No new `import AVFoundation` (N/A here — CDP is not a capture-path module; this rule is M5's, listed for completeness).

**Standards:** Behavioral match to `src/cdp/**` — same DevTools domains, same request/response shapes as the TS reference (this is what the M2B conformance suite will check once it exists; until then, match by code review against the TS source line-by-line for the domains in use).

**Expected outcome/artifact:** `macos/Spectra/CDP/**` Swift target compiles standalone and inside the Xcode project; a demo capture (screenshot + DOM read) against a real Chrome tab, with logs/screenshots as evidence; a short port-notes doc (which CDP domains/methods were ported, which were skipped as unused) for Claude's M3.G3 consumption.

**Guardrails:** all three apply; guardrail 2 matters if any test probe writes capture output — isolate to a temp `SPECTRA_HOME`.

---

### Arm 3 — M5: Polish orchestration port to Swift

**Goal:** Port pipeline orchestration to Swift: job graph, zoom/pan math, cursor smoothing, timing, segment assembly. Source is `src/pipeline/` (12 files, ~120KB: `annotations.ts`, `auto-zoom.ts`, `cursor-telemetry.ts`, `framing.ts`, `polish.ts`, `script-runner.ts`, `script.ts`, `spotlight.ts`, `text-render.ts`, `window-focus.ts`, `zoom-keyframes.ts`, `zoom-render.ts`) plus the orchestration-relevant parts of `src/media/` (`pipeline.ts`, `presets.ts`, `production.ts`, `spotlight.ts` — **not** `ffmpeg.ts`, `capture.ts`, `clean.ts`, `png.ts`, `recorder.ts`, which stay TS-shelled or are out of scope). This feeds M3 group G4.

**ffmpeg stays shelled** — do not port ffmpeg invocation to AVFoundation. This is a locked non-goal (plan §"Non-goals" + Risk R3) enforced by a **path-scoped CI grep** that fails on any NEW `import AVFoundation` inside `macos/Spectra/Pipeline/**` or `macos/Spectra/Render/**` specifically (capture code elsewhere legitimately imports AVFoundation and is exempt — do not "fix" the grep). Identical ffmpeg arg construction is part of the port spec — diff old-vs-new ffmpeg command lines, they should match.

**CoreText renderer note (❓ unverified):** M2A (native CoreText renderer replacing python3/Pillow) is already committed (`3fc1800`) but I could not confirm from the file layout whether it currently lives inside the Xcode project (`macos/Spectra/Render/**`) or is still a standalone `swiftc` binary at `native/swift/text-render/` (the `package.json` `build:text-render` script still targets `native/swift/text-render/*.swift` as of this hand-off). If it's still standalone, re-homing `text-render` into `macos/Spectra/Render/**` as an in-bundle target may be in-scope for M5 (the plan says "CoreText renderer from M2A is now called in-process/in-bundle" for M5) — confirm with Claude/orchestrator before assuming this is Codex's job vs already done.

**Owned files/paths:** NEW `macos/Spectra/Pipeline/**` only (plus possibly `macos/Spectra/Render/**` re-home per the ❓ above, if confirmed in scope). `src/pipeline/**`, `src/media/**` are **read-only** reference implementations — retirement of the TS versions happens post-M3.G4 acceptance and is Claude/M3-gated, NOT part of this arm. Do not delete or edit anything under `src/`, `src/daemon/`, `src/cdp/`, `native/swift/` (leave TS/existing native code untouched — retirement is a separate, later, Claude-owned commit).

**Worktree setup:**
```bash
cd /Users/tyroneross/dev/git-folder/spectra
git worktree add ../spectra-m5-pipeline -b codex/m5-pipeline-port main
cd ../spectra-m5-pipeline
```
Same note as Arm 2 — do not reuse the stale `.rally/worktrees/codex-0{1,2,3}` worktrees without confirming with the orchestrator first.

**Acceptance/test criteria:**
- Golden-video comparisons: SSIM per keyframe + duration/frame-count/audio-offset invariants, old (TS+ffmpeg) vs new (Swift+ffmpeg) — on-device/code-review-verifiable, not just "compiles."
- ffmpeg command-line diff old-vs-new = identical (or an explicitly Fable-approved delta — do not silently change ffmpeg args).
- Conformance suite green for demo/composite ops vs the Swift daemon — ❓ same M2B-not-yet-landed caveat as Arm 2; proceed on the other criteria in the meantime.
- Mutation spot-check on zoom/pan math (seed a deliberate behavior change, confirm it's detectable by the golden-video comparison).
- Path-scoped AVFoundation grep stays clean (see above).
- XCTest per ported module.

**Standards:** Behavioral match to `src/pipeline/` + the in-scope `src/media/` files — same job-graph semantics, same zoom/pan/cursor math, same segment-assembly output. ffmpeg stays shelled with identical args.

**Expected outcome/artifact:** `macos/Spectra/Pipeline/**` Swift target compiles standalone and inside the Xcode project; golden-video comparison results (SSIM numbers, ffmpeg arg diff) as evidence; a port-notes doc for Claude's M3.G4 consumption noting any TS behavior that was ambiguous or under-specified (route those to Opus escalation per the plan's model-org note, not silent judgment calls).

**Guardrails:** all three apply; guardrail 2 is critical here — polish/render test fixtures must not write into the real `.spectra/`.

---

## What Codex must NOT touch

- `tests/conformance/**`, `tools/dual-run/**` (does not exist yet — M2B deliverable) — Claude-owned parity oracle.
- `src/contract/**` (`contract.spec.json`, `enriched-spec.ts`, `contract.snapshot.json`) — frozen contract; any edit is a plan violation (Risk R1 in the plan). Currently mid-edit by Claude (`git status` shows `src/contract/contract.spec.json`, `src/contract/enriched-spec.ts`, `tests/contract/enriched-spec.test.ts` as modified-uncommitted) — do not touch these files even read-adjacent, to avoid merge conflicts with in-flight work.
- `src/daemon/**` — read-only per the plan; ports to Swift happen in M3 (`macos/Spectra/DaemonCore/**`), Claude-owned.
- `macos/Spectra/Daemon/LaunchAgentManager.swift` — the M3 routing table; Claude-owned, is both the decomposition and the rollback mechanism for the strangler cutover.
- `src/client/**`, `src/cli/**`, `src/mcp/**` (transport/registry) — stay TS by locked decision (non-goal), out of scope for every arm here.
- Any TS-internal vitest suite retirement (`src/pipeline/`, `src/media/`, `src/daemon/` deletion) — that's the M5-retirement step, gated on M3.G4 acceptance, Claude-owned. Arms 2/3 here are **ports only** (new Swift files), not deletions of the TS originals.
- `.spectra/` — protected real data, guardrail 1, non-negotiable regardless of arm.
- Rally state (`.rally/**`) — the orchestrator posts the handoff; Codex should coordinate presence/claims through the normal `rally` CLI, not by hand-editing anything under `.rally/`.

---

## Ready-to-post rally handoff summary

Rally `say handoff` takes `--subject` (short title) + `--summary` (context) + `--path` (owned paths) + `--evidence` — NOT `--title`/`--body`. Full per-arm spec lives in this doc; the handoff points Codex here.

```
rally say handoff --tool claude_code --target codex \
  --subject "M1 GUI-verify: sign/notarize + on-device privacy check" \
  --path macos/Spectra --path macos/project.yml \
  --summary "Prove Spectra.app (M1 code on main @104e362) signs, shows in macOS 26.1 Screen Recording + Accessibility panes, and captures from the bundle. Ad-hoc codesign default; REAL-identity signing needs the user — prep the step, never auto-sign. Acceptance: xcodebuild all targets green + on-device screenshot evidence of both privacy-pane entries + a real non-black capture, report ✅/⚠️/❓ per item. Guardrails: never touch .spectra/; temp SPECTRA_HOME for capture tests; Chrome --password-store=basic --use-mock-keychain. Full spec: docs/plans/codex-parallel-handoff.md §Arm 1."

rally say handoff --tool claude_code --target codex \
  --subject "M4: port src/cdp/ (951 LOC) to Swift" \
  --path macos/Spectra/CDP \
  --summary "Swift CDP client (WebSocket + DevTools domains in use) driving real system Chrome (--password-store=basic --use-mock-keychain), feeding M3 group G3. Owned: NEW macos/Spectra/CDP/** only; src/cdp/** read-only reference; do not touch src/daemon, src/contract, macos/Spectra/Daemon. Worktree: git worktree add ../spectra-m4-cdp -b codex/m4-cdp-port main (NOT the stale .rally/worktrees/codex-01..03). Acceptance: live Chrome capture on 26.1, edge cases (attach/detach, OOPIF, WS reconnect), XCTest per module; conformance-suite check blocked until Claude lands M2B — proceed on the rest. Full spec: docs/plans/codex-parallel-handoff.md §Arm 2."

rally say handoff --tool claude_code --target codex \
  --subject "M5: port polish orchestration (src/pipeline/ + src/media/ subset) to Swift" \
  --path macos/Spectra/Pipeline --path macos/Spectra/Render \
  --summary "Swift port of job-graph/zoom-pan/cursor/timing/segment-assembly, feeding M3 group G4. ffmpeg STAYS shelled (identical args) — path-scoped CI grep forbids new AVFoundation in macos/Spectra/Pipeline/** + macos/Spectra/Render/**. Owned: NEW macos/Spectra/Pipeline/** + macos/Spectra/Render/** (re-home native/swift/text-render/ into an in-bundle target — CONFIRMED in-scope: renderer is still a standalone swiftc binary). src/pipeline/**, src/media/** read-only; no TS deletion (retirement is later, Claude-gated). Worktree: git worktree add ../spectra-m5-pipeline -b codex/m5-pipeline-port main (NOT stale .rally worktrees). Acceptance: golden-video SSIM + duration/frame/audio invariants, ffmpeg arg diff identical, mutation spot-check on zoom/pan, XCTest per module; conformance check blocked until M2B lands. Full spec: docs/plans/codex-parallel-handoff.md §Arm 3."
```

---

## Gaps for the orchestrator to fill before posting

1. **Stale rally worktrees:** `.rally/worktrees/codex-01/02/03` exist, are 83-89 commits behind `main`, and hold unrelated already-merged composite-capture work. Confirm whether rally should retire/reclaim these or whether Codex should get fresh worktrees (as scripted above) — this doc assumes fresh.
2. **M2B landing timing:** M4/M5 acceptance criteria that depend on the conformance suite are blocked until Claude commits M2B (currently uncommitted WIP per the RESUME doc's D1-D5 fix list). Confirm whether Codex should start now against the non-conformance criteria (recommended — the plan calls M4/M5 parallelizable against M2B) or wait.
3. **CoreText renderer location (✅ RESOLVED by orchestrator):** M2A's renderer is STILL a standalone `swiftc` binary — `native/swift/text-render/TextRender.swift` exists and `package.json`'s `build:text-render` compiles it to `$HOME/.spectra/bin/spectra-text-render`; `macos/Spectra/Render/**` does NOT exist yet. So M5's "CoreText called in-process/in-bundle" acceptance item is NOT satisfied — re-homing `text-render` into a new in-bundle `macos/Spectra/Render/**` target IS in-scope for M5 (Codex-owned). Leave the standalone `native/swift/text-render/` + `build:text-render` intact until M3.G4 acceptance (retirement is Claude-gated).
4. **M1 real signing:** if an actual notarized (not ad-hoc) build is needed to see the app in the privacy pane persistently, the user needs to be in the loop for the signing step at the time Codex reaches that point — not assumable as unattended work.
