# Native-Swift migration — RESUME (start here in a fresh session)

_Last worked: 2026-07-01. Full plan: `docs/plans/native-swift-migration.md`. Model org: Fable = assess/judge/critic, Opus = orchestrate, Sonnet = execute, cheap/Haiku = mechanical. Track dispatches in `.build-loop/measurements/`._

## ⚠️ MANDATORY guardrails in EVERY subagent dispatch
1. **Never delete a dir/file you didn't create** — no `rm`/`rmSync` of non-owned paths. A subagent rmSync'd the repo's real `.spectra/` (226 sessions/50 recordings/productions) thinking it was junk — unrecoverable. `.spectra/` is PROTECTED real data.
2. **Isolate storage to a temp root** for any test/probe that could write captures — set temp `HOME`/`SPECTRA_HOME`; never let `storage.ts` resolve to the repo's real `.spectra`.
3. **Keychain-safe** (already committed `a0d645e`): ad-hoc codesign is the default (`SPECTRA_CODESIGN_IDENTITY` opt-in only); Chrome launches `--password-store=basic --use-mock-keychain`. Never trigger the login keychain.

## Done + committed (on `main`, pushed)
- `bad0e9e` plan · `104e362` **M1** (helpers embed in `Spectra.app/Contents/Helpers/` + bundle-first resolution; enriched `src/contract/contract.spec.json` = 30 ops, nested result types, hash-frozen — the oracle source of truth) · `a0d645e` keychain guardrail · `3fc1800` **M2A** (native CoreText renderer, python3/Pillow removed).
- M1 deferred to a GUI pass: real sign/notarize the `.app`, macOS-26.1 privacy-pane visibility, capture-from-bundle.

## ▶ NEXT TASK: finish M2B (the parity oracle) — it has KNOWN defects, fix before committing
Uncommitted WIP in the working tree: `tests/conformance/` (harness + `corpus/golden-corpus.json` + `normalize.ts` + `mutation-check.ts`) and H2 edits to `src/contract/{enriched-spec.ts,contract.spec.json}` + `tests/contract/enriched-spec.test.ts`. A Fable gate found it currently **green-lights a broken Swift daemon on the core ops** — DO NOT commit until fixed. Fix list (Sonnet execute, Fable re-gate):
- **D1 (KILLER):** ops run alphabetically; `closeAllSessions` (4th) destroys the fixture sessions, so ~14 session-dependent ops (snapshot, step, startRecording, stopRecording, screenshot, getSession, observe, discover, demo, createSession[full], autoRampDemo, getRecording, getRun, llmStep, replayTerminal, walkthrough) only assert the ERROR path — zero success-shape. Fix: run session-destroying ops LAST or re-seed a session per op; re-record `golden-corpus.json`; add a GUARD test that FAILS if any succeedable-under-fakes op is error-only (empirically determine the succeedable set; explicitly allowlist the genuinely-can't ones).
- **D2:** `<SYNTHETIC_AX_ID>` regex `\bex[0-9a-z]+\b` in `normalize.ts` matches ordinary words (exited/export/exact/expanded) → masks text drift. Tighten to the real synthetic id shape (see `src/cdp/accessibility.ts`).
- **D3:** `validateLeaf` only checks `typeof==='string'` → literal/enum result values (e.g. `PermissionState`) gated nowhere. Add literal-set validation from the enriched spec.
- **D4:** H2 op→capability map is in the spec but ZERO conformance code uses it. Add ≥1 denied-capability probe (invoke an op without its capability → assert denied).
- **D5:** seed fixtures for `replayTerminal`/`library:add` (ENOENT `.cast`/ffprobe) — 2 already created: `tests/conformance/fixtures/{fixture-input.mp4,fixture-recording.cast}`.
- **Verify:** full suite green; the D1 guard test PROVEN to bite (re-break ordering → red); **mutation on a core op (`snapshot`/`startRecording`) result-shape now FAILS the gate** (it wouldn't have before D1) — red-before/green-after. Keychain-safe. THEN Fable re-gate → commit M2B.

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
