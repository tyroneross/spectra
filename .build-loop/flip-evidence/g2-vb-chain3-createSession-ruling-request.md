# G2 wave-2 re-run — createSession real-Chrome non-determinism (Advisor ruling request)

Log: `/tmp/g2-chain3.log`. Wave-2 fixes (S4 seed, S5 recordTerminal reaper, S7 error-metadata mask + V-B getRecording consume) all landed; union compile exit 0.

## Result: RED collapsed to createSession non-determinism + one harness gap

**GREEN now:** T-23 all 7; V-B chains 1 & 2 fully green incl. both G1 31/31 arms (Gate B-diff 31/31, Gate B-e2e, Gate C 31/31, Gate D mutation, T-10); error-metadata/caller-deliveryPath/timeline/discover/recordTerminal-timeout/T-24 all pass; recordTerminal V-A valid-payload now terminates (~5s, was ∞ hang).

**Two failures, one root cause — createSession web path is real-Chrome/non-deterministic:**

1. **Gate B-diff createSession — chain-3 ONLY (flake, in the G1-FROZEN verify-flip-suite.ts):**
   - chain 1: `✔ (direct 5130ms / proxy 5173ms)` — both legs ~5s, byte-equal
   - chain 2: `✔ (direct 5124ms / proxy 5149ms)` — both ~5s, byte-equal
   - chain 3: `✗ (direct 5137ms / proxy 656ms) — direct=500 proxy=200`
   - Interpretation: createSession(web fixture URL) launches a REAL headless Chrome (~5s). It loads `chrome-error://chromewebdata/` (unreachable fixture, seen in T-24). Intermittently one leg's Chrome launch/nav fails → 500 while the other → 200. The op is ALREADY labeled `byte-diff N/A: real-Chrome/stateful` in corpus.test.ts. Gate B-diff's calibrated-volatile currently masks only `error.message`+`timestamp` — it cannot absorb a status 500-vs-200 flip. This is a PRE-EXISTING G1 gate fragility (real-Chrome createSession byte-compared as deterministic), exposed by the G2 3-chain requirement — NOT a G2 regression (product code unchanged for createSession-web; S6/S1 verified routing correct via live socket probe).

2. **corpus createSession[full] ok-drift (SG-5-protected corpus.test.ts):**
   - recorded `[full]` = `{name, record:true, target:<web fixture>}` → ok:FALSE (TS real-Chrome+record failed)
   - `payload-generator.ts:106` rewrites target→`fake:conformance-seed` under milestone=g2, so replay serves native → ok:TRUE → mismatch.
   - `corpus.test.ts:224` skip = `!SWIFT_G1_VERIFIABLE_OPS.has(op)`; the g2 widening ADDED createSession to that set (needed for conformance shape-check) which un-skipped it for corpus. createSession corpus entries are web-recorded, unreplayable on the driverless standalone Swift daemon (the original G1 skip rationale still holds).

## Ruling requested
1. **createSession-web is real-Chrome/non-deterministic → authorize a classed exclusion consistent with corpus.test.ts's own `real-Chrome/stateful` label, in BOTH gates.** For Gate B-diff (verify-flip-suite.ts, G1-frozen): may createSession's status/ok/error be excluded from byte-diff (kept as a route-fingerprint / presence check only), the same way the 6 capture ops are class-masked? Preserve the G1 regression floor — name exactly what stays asserted so a real createSession routing regression still convicts.
2. **corpus createSession under milestone=g2:** the clean fix (skip createSession from the corpus shape-only check) requires editing corpus.test.ts:224 (SG-5 protected, zero-edit) OR a lib-level lever. Options: (a) SG-5 exception to add createSession to the corpus skip; (b) a separate `SWIFT_G2_CONFORMANCE_ONLY` set so conformance widens but corpus doesn't; (c) scope `payload-generator.ts`'s milestone target-override so corpus replay keeps the recorded web target (then both [minimal] & [full] tunnel→ok:false standalone — but [minimal] recorded ok:true, so it'd need skipping too). Rule which, respecting SG-5.
3. **Confirm the getRecording V-A fix direction:** D1 guard still RED — S4 seeded `conformance-seed-recording` in RecordingOps, but the V-A conformance suite's `fixture-context.ts` never sets `ctx.recordingId` to it (payload-generator's recordingId hint = `ctx.recordingId ?? 'unknown-recording-id'`). Fix = set `ctx.recordingId='conformance-seed-recording'` under SPECTRA_CONFORMANCE_SEED in fixture-context.ts. Confirm + name any protected-file constraint.

End with a `## Fix work-list` (owned files + exact edits) so the orchestrator fans out. Note which files are SG-5-protected and must NOT be edited; if an SG-5 exception is genuinely required, say so explicitly with justification (it is a user-approved constraint).
