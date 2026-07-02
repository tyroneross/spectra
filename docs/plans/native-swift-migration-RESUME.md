# Native-Swift migration — RESUME (start here in a fresh session)

_Last worked: 2026-07-01. Full plan: `docs/plans/native-swift-migration.md`. Model org: Fable = assess/judge/critic, Opus = orchestrate, Sonnet = execute, cheap/Haiku = mechanical. Track dispatches in `.build-loop/measurements/`._

## ⚠️ MANDATORY guardrails in EVERY subagent dispatch
1. **Never delete a dir/file you didn't create** — no `rm`/`rmSync` of non-owned paths. A subagent rmSync'd the repo's real `.spectra/` (226 sessions/50 recordings/productions) thinking it was junk — unrecoverable. `.spectra/` is PROTECTED real data.
2. **Isolate storage to a temp root** for any test/probe that could write captures — set temp `HOME`/`SPECTRA_HOME`; never let `storage.ts` resolve to the repo's real `.spectra`.
3. **Keychain-safe** (already committed `a0d645e`): ad-hoc codesign is the default (`SPECTRA_CODESIGN_IDENTITY` opt-in only); Chrome launches `--password-store=basic --use-mock-keychain`. Never trigger the login keychain.

## Done + committed (on `main`, pushed)
- `bad0e9e` plan · `104e362` **M1** (helpers embed in `Spectra.app/Contents/Helpers/` + bundle-first resolution; enriched `src/contract/contract.spec.json` = 30 ops, nested result types, hash-frozen — the oracle source of truth) · `a0d645e` keychain guardrail · `3fc1800` **M2A** (native CoreText renderer, python3/Pillow removed).
- `1ee01d2` **M2B** (the parity oracle) — all 5 defects (D1–D5) fixed + Fable-gated PASS. 30/30 ops reach their success path; D1 guard (`SPECTRA_CONFORMANCE_BREAK_ORDER` proves it bites); enum-value validation; capability-gate probe; mutation-check red-before/green-after on health/snapshot/getSession; storage isolated to temp (was recreating the repo's real `.spectra` — guardrail #2 breach, now fixed); shared `tests/conformance/lib/op-order.ts` keeps the live suite + corpus recorder on identical ordering. conformance 170/170 stable, tsc clean. `a77885c` Codex parallel-handoff doc.
- M1 deferred to a GUI pass: real sign/notarize the `.app`, macOS-26.1 privacy-pane visibility, capture-from-bundle. **Now handed to Codex** (rally handoff `fact_146f_18be6ae67fa2eb88`).
- **M2B findings backlogged** (src/contract & src/daemon read-only for M2B): `startRecording`/`stopRecording`/`screenshot` results are all-optional (a `{}` passes the shape gate — corpus is their only backstop → tighten required fields in core-api.ts); daemon does not server-side-validate params; external-daemon (Swift) fixture seeding needs a wire-level path for M3; normalize temp-path rule could preserve the extension.

## ▶ NEXT TASK: M3 — strangler-per-op Swift daemon cutover (M2B is DONE, `1ee01d2`)
M2B (the oracle) is committed + Fable-gated. The M2B fix history is preserved below the line for context. Pick up at **M3.G1** (health/session ops). Per-op routing table in `LaunchAgentManager` = decomposition + rollback; each op-group flips only after the oracle passes; dual-run TS vs Swift. Point the SAME conformance suite at the Swift daemon via `SPECTRA_DAEMON_SOCKET` (the seam is already built — `tests/conformance/lib/daemon-endpoint.ts`). **First M3 chore:** wire a wire-level fixture-seeding path for the external (Swift) daemon — the in-process fixture seams (readonly session + seeded recording) only exist for the harness-spawned TS daemon; without a wire-equivalent, getSession/getRun/getRecording will false-RED against a conforming Swift daemon (see M2B backlog above). M4 ∥ M5 (Codex, isolated worktrees — handoffs posted) feed G3/G4.

<details><summary>M2B fix history (done — for context)</summary>

D1 (ordering + guard, shared `lib/op-order.ts`), D2 (AX-id bracket anchor), D3 (enum-value validation via literal-union nodes in the enriched spec), D4 (capability-gate probe off the H2 map), D5 (staged `.cast`/`.mp4` fixtures). Plus: storage isolation (cwd=temp, was hitting the repo's real `.spectra`), read-op isolation (pristine seeded session), corpus recorder ordering fix + corpus-level D1 guard, generalized mutation-check. All verified; Fable gate PASS-WITH-FINDINGS (findings backlogged above).
</details>

## Remaining milestones (after M2B green)
Critical path: **M2B → M3.G1…G4 → M5-retirement → M6**. Parallelizable: M4 ∥ M5 (isolated worktrees; feed M3's G3/G4).
- **M3** strangler-per-op Swift daemon cutover, groups G1 health/session → G2 capture/AX → G3 web(needs M4) → G4 demo/polish(needs M5). Per-op routing table in `LaunchAgentManager` = decomposition + rollback. Each group flips only after the oracle passes. Dual-run TS vs Swift. **Riskiest.**
- **M4** port `src/cdp/` (951 LOC hand-rolled CDP) to Swift, keep driving system Chrome (`--password-store=basic`). Feeds G3.
- **M5** port polish orchestration to Swift (ffmpeg STAYS shelled — path-scoped CI grep forbids new AVFoundation in polish paths; CoreText renderer from M2A already native). Then retire `src/daemon`/`src/pipeline`/`src/cdp` TS WITH their TS-internal vitest suites; survivors = conformance suite + dual-run + golden-media + XCTest.
- **M6** MCP 2026-07-28 Tasks (long record/polish jobs) + MCP-App dashboard (in-host) in the thin TS shim; optional Foundation Models narration (mixed-compute, AX-first primary). Re-eval Swift MCP SDK.

## Hand-off to Codex — best candidates
Codex runs in a real GUI session + has won bounded A/B/C rounds. Give it:
1. **M1 GUI-verify** (only doable with a GUI + your signing): build/sign/notarize `Spectra.app`, confirm it shows in macOS-26.1 Screen-Recording privacy pane, capture-from-bundle works. (Signing needs YOUR Apple identity — Codex drives the build, you approve signing.)
2. **M4 or M5 Swift ports** as A/B/C arms (Codex vs Sonnet vs Opus) in isolated worktrees — bounded, well-specced, code-review-verifiable.
3. **Live on-device verification** the CC bash context can't do (real screen capture, privacy pane, notarization).
Keep the oracle (M2B) + orchestration + judging on the Claude side (Fable/Opus).

## `.spectra` incident (context for the fresh session)
The repo's `.spectra/` is gone (deleted 2026-07-01, no TM/APFS/Trash recovery). It was intermediate capture/session state + productions. The high-value marketing deliverables are SAFE elsewhere: `~/dev/git-folder/ross-labs-astro/demo-candidates/` (polished demos, before/after, archive) and this session's scratch clips. `~/.spectra/` (daemon home, 509 sessions) is a different dataset, intact.
