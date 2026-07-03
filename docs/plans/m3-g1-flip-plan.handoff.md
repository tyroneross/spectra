# Handoff: M3.G1 Routing Flip — implementer briefs — rev 3.5 (terminal class-mask ruling)

Source of truth: `docs/plans/m3-g1-flip-plan.md` (§Gate redesign rev 3.5). Verdict state: GV-1 ✔ · GV-2 ✔ (durable `--no-file-parallelism` fix; B-e2e stably green ×2) · GV-3 ✔ CLOSED (Q-01 user-approved pre-implementation) · GV-4a ✔ (mutation red/green evidence on file) · GV-4b ✔ (22→24 = the 2 listWindows tests). This rev routes ONE delta: **S4 — class-pattern masks for the capture/AX op class.** Then 3 consecutive green chains → flip commit → Gate E. Global rules bind (rally claim first; never commit; pins are law; temp HOME; SEED + SEED_SESSION recipe; ✅/⚠️/❓ claims).

## S4 delta (rev 3.5) — class-pattern masks (Advisor-authorized, TERMINAL)

**Ruling context (do not re-litigate):** per-run 3-sample calibration is inherently unreliable for low-variance volatile fields — a fast op returns identical durationMs across 3 samples, then differs ±1ms on the proxy leg (run1 llmStep `result.results[0].durationMs`; run2 walkthrough `result.duration_ms`; different op each run = sampling noise, not a defect; 14 deterministic ops byte-equal every run; a byte tunnel cannot selectively edit one duration field). The class-based approach is CONFIRMED with tighter scoping than requested — unanchored globs are how a transparency gate goes decorative.

Implement exactly:

1. **Op scope (closed set — do not widen):** `act`, `observe`, `snapshot`, `step`, `llmStep`, `walkthrough`. Every other op keeps pure calibrated byte-equality. All previously-ruled per-op masks stand unchanged (screenshot `result.path`, recordComposite `result.recordingId`, getRecording `result.recording.updatedAt`, createSession `error.message`, recordLlmUsage `result.entries`, recordTerminal `result.timeline` structural).
2. **Class patterns — anchored, matching ONLY beneath `result.`, never at envelope level:**
   - `duration`: leaf key exactly `duration` | `durationMs` | `duration_ms`, any depth under `result` → typed guard: JSON **number ≥ 0** on both legs.
   - `embedded-content`: exact paths `result.snapshot` | `result.finalSnapshot` → typed guard: JSON **string, non-empty** on both legs.
   - `temp-path`: leaf key exactly `screenshotPath`, any depth under `result` → typed guard: JSON **string, non-empty** on both legs.
   - **No generated-id pattern** for these six ops (unobserved there). No patterns for unobserved fields — observed-need only.
3. **Guards:** presence + the typed assert per pattern-hit, both legs; a hit that is missing, retyped, negative (duration), or empty (string classes) = REAL FAIL. Structural fields stay unmaskable (`ok`, `error.code`, `apiVersion`, `requestId`, `caller`/`deliveryPath` presence, HTTP status, Content-Type).
4. **Ledger (pattern-hit transparency):** t02-masks.json entries for these ops gain `mode: "class-pattern"` records carrying the class name AND the **resolved concrete paths** the pattern matched this run — the audit reviews what was actually masked, not the pattern text. Growth of a resolved-path set across runs = WARN in the report.
5. **Calibration stays on as a diagnostic:** keep computing and reporting calibrated-volatile sets; any calibrated path OUTSIDE the approved classes still requires an Advisor ruling before masking (unchanged).
6. **Deterministic-set discipline:** if any op OUTSIDE the six-op scope flakes, that is a FINDING routed to the orchestrator/Advisor — never a mask candidate. The deterministic set is the standing tunnel-fidelity proof.
7. **Named-but-NOT-pre-approved future claimant** (for your awareness, no code now): stateful-read timestamp leaves (`updatedAt`/`createdAt`/`startedAt`) on session/recording reads — stable today because fixtures are static; if one ever flakes, stop and request a ruling citing rev 3.5.

**Acceptance:** run the full chain **3 consecutive times** — B-diff 31/31 each, B-e2e green each, A/B2/C/D green each. Commit as C5g. Then Opus proceeds to the flip commit (C7) and hands the user Gate E (live flip + soak + rollback drill).

---

<details><summary>rev 3.4 (group-verdict conditions — ALL CLOSED)</summary>

GV-1: T-02c excludes corpus-arm tests for natively-routed ops only (class `native-route-corpus-basis`); conformance arms stay in the basis. GV-2: recordLlmUsage — root cause was test-file parallelism racing the shared usage counter; durable fix `--no-file-parallelism`; excluded entries classed `dual-leg-state-order`, audited. GV-3: Q-01 user approval predated implementation (stale doc line, corrected). GV-4a: manual Gate-D mutation executed — assert removed → capability-gate 10F/21P RED; restored → 31/31 GREEN; evidence `.build-loop/flip-evidence/gate-d-manual-mutation.txt`. GV-4b: Gate-A 22→24 = the two listWindows allowlist tests.

</details>

<details><summary>rev 3.3 (recordTerminal timeline structural comparison — in force, audited clean)</summary>

`recordTerminal → result.timeline` ONLY: both legs present, array, length ≥ 1, elements `{event: string, time: number}` (extra keys tolerated, not byte-compared); no byte comparison of element values; siblings stay value-masked; `replayTerminal` EXCLUDED (fixed cast, fully compared); ledger class `generated-recording-content`, `mode: structural`; structural-assertion failure = REAL FAIL.

</details>

<details><summary>rev 3.2 (calibrated mask — in force, audited clean)</summary>

Deterministic mask: top-level `timestamp`. Calibrated: paths differing across 3 direct samples ≥1.1s. Guards: presence+type per masked path; structural fields NEVER maskable — calibration flagging one = gate ERROR (`error.message` maskable, `error.code` not); t02-masks.json persistence + growth WARN; approved classes: timestamps (incl. embedded), durations, generated ids, temp paths, free-text, generated-recording-content (recordTerminal.timeline only) — rev 3.5 adds class-pattern mode for the six-op generative set; unmasked divergence = FAIL; new classes need an Advisor ruling. Suite: continue-on-fail, one report, aggregate exit code. Standing note: `recordLlmUsage.result.entries` = weakest mask on record; re-examine when G2 touches usage recording.

</details>

<details><summary>rev 3.1 / rev 3 / rev 2 (in force where not superseded)</summary>

rev 3.1: native ops = route fingerprint (`caller`/`deliveryPath` ABSENT; health `-swift-g1`); proxied = metadata PRESENT both legs; `caller`/`deliveryPath` optional contract fields (wire.ts:202/234/277, schemas.ts:605), zero readers, Swift omission conformant; corpus out of Gate A; TS corpus keeps running vs TS direct; C8 = post-verdict Swift-baseline corpus; latency parity ≤ direct+2s; SSE smoke; error-provenance; wire edges.

rev 3: S1 loader backend-aware rule (session ops in native:[] only when backend UNSET AND `SPECTRA_STANDALONE_SESSION_OPS=1`; backend → refuse; falsifiers i/ii/iii GREEN); T-02c measured-equality + classed excluded-set + 0600; capability-gate scoping (11 registered strict, unregistered exactly not_found); legacy suites set the standalone flag (harness env only, NEVER in a plist).

rev 2: pins P1 (S2 frozen surface) / P2 (LibraryStore no-arg) / P3 (env read at isMainModule callsite; daemon-runner.ts:141 protected) / P4 (env-gated, signature-stable, allowlist append-only, skip-set derived) / G2a (LaunchAgentManager signatures unchanged, full-topology semantics, isInstalled=both, actionable missing-binary failure); pin-protected never-edit files: SpectraViewModel.swift, SessionOps.swift, PermissionOps.swift, LibraryOps.swift, daemon-runner.ts; flip-g1.sh stale-dist check; rollback-g1.sh <2 min; S2/S3/S5 COMPLETE.

</details>
