# M3 continuation handoff — Claude/Fable side (Swift daemon strangler cutover)

**What this is:** the next-steps package for the side that owns M3 (Claude/Fable), complementing `codex-parallel-handoff.md` (which owns M1-GUI + M4 + M5). Pick up here after M3.G1's Swift daemon-core landed.

## State (verified `main` @ `32e1de0`)
- **M3.G1 built + oracle-verified**: Swift daemon-core (unix-socket server + `health`, `8354790`) + all **11 control-plane ops** (`32e1de0`), each oracle-verified + mutation-proven. Uncommitted WIP exists in `macos/Spectra/DaemonCore/**` + `tests/conformance/**` (active peer — coordinate before editing).
- **Oracle seam ready**: point the same conformance suite at the Swift daemon via `SPECTRA_DAEMON_SOCKET` / `tests/conformance/lib/daemon-endpoint.ts`. Dual-run TS-vs-Swift is the flip gate.
- **Routing table** lives in `macos/Spectra/Daemon/LaunchAgentManager.swift` — per-op route = both the decomposition and the rollback (flip an op back to TS by flipping its route).

## The decision the rally handoff names: flip / pre-flip-backlog / G2
**Recommended order: pre-flip-backlog → flip G1 → G2.** Do NOT flip G1 with a known oracle false-RED.

1. **PRE-FLIP BACKLOG (do first — it's a flip prerequisite).** The in-process fixture seams (read-only seeded session, seeded recording) exist ONLY for the harness-spawned TS daemon. Against an external Swift daemon, `getSession`/`getRun`/`getRecording` will **false-RED** (no state to read) even if the Swift daemon is correct. Build the **wire-level fixture-seeding path** designed in `docs/plans/m3-external-daemon-seeding.md` — a way to seed a known session/recording into the external daemon over the wire before the read-ops are graded. Without it, the G1 flip's oracle run is not trustworthy. Verify: oracle green for all 11 G1 ops pointed at the Swift daemon via `SPECTRA_DAEMON_SOCKET`, seeded, with the D1 guard + mutation-check still biting.
2. **FLIP G1.** Route the 11 control-plane ops to the Swift daemon in `LaunchAgentManager`. Dual-run: the oracle must be green against BOTH the TS and Swift daemons for these ops (identical normalized corpus). Fable gate the flip. Rollback = flip the routes back (leave the TS handlers in place — do not retire until M5).
3. **G2 — capture/AX ops.** Port the capture/AX op handlers to Swift daemon-core (the native capture/AX/Vision helpers are already Swift — this is wiring the daemon ops to them, keychain-safe). Same gate: oracle green over the socket + mutation-check bites on a G2 result shape + Fable verdict, then flip G2's routes.

## Remaining groups (unchanged from the plan)
- **G3 web** — blocks on **M4** (Codex Swift CDP port) landing + accepted. Flip web ops after M4 merges and the oracle is green for them.
- **G4 demo/polish** — blocks on **M5** (Codex Swift pipeline port) landing + accepted. ffmpeg stays shelled; CoreText renderer (M2A) already native.
- **M5-retirement** — only after G4 flips: retire `src/daemon`/`src/pipeline`/`src/cdp` TS WITH their TS-internal vitest suites; survivors = conformance suite + dual-run + golden-media + XCTest.
- **M6** — MCP Tasks + MCP-App dashboard in the thin TS shim; optional Foundation Models narration.

## Guardrails (verbatim in every dispatch)
1. Never delete a dir/file you didn't create; `.spectra/` is protected — don't touch it.
2. Isolate storage to a temp root (temp `HOME`/`SPECTRA_HOME`) for anything that could write captures.
3. Keychain-safe: ad-hoc codesign default (real identity opt-in only, user-supplied); Chrome `--password-store=basic --use-mock-keychain`.

## Model org
Sonnet executes the Swift op-ports; escalate to Opus on ambiguity/2-fail; **Fable gates every flip** (no group flips without a Fable verdict against the oracle); cheap/Haiku for mechanical moves. Track dispatches in `.build-loop/measurements/`.

## Ready-to-post rally handoff (Claude/Fable next executor)
> PICK UP M3: pre-flip backlog first — build the wire-level fixture-seeding path (`docs/plans/m3-external-daemon-seeding.md`) so getSession/getRun/getRecording don't false-RED against the Swift daemon; verify the oracle is green for all 11 G1 ops via `SPECTRA_DAEMON_SOCKET` (D1 guard + mutation-check still bite); then flip G1's routes in `LaunchAgentManager` (dual-run TS+Swift green, Fable-gate the flip, rollback = route-flip); then start G2 (capture/AX op-ports). Guardrails: never delete non-owned dirs, temp storage root, keychain-safe. Do not retire any TS until M5.
