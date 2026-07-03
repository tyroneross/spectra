# ⏩ M3.G2 — PICK UP HERE (handoff, 2026-07-03)

**Read this first, then `docs/plans/m3-g2-plan.md` (rev 2) + `.handoff.md`.**

## Where G1 stands (done — context)
G1 (5 control-plane ops + the Swift front-door flip) is **BUILT, VERIFIED, and LIVE** on this machine. HEAD `eb82df4` on main. Swift front door (`dev.spectra.daemon`) serves the primary socket, TS backend (`dev.spectra.daemon-ts`) proxies the rest. Rollback any time: `bash scripts/rollback-g1.sh`. Canonical status: `build-loop-memory/projects/spectra/status/CURRENT.md`.

## Where G2 stands (in-flight — pick up here)
Plan: `docs/plans/m3-g2-plan.md` **rev 2** — verified (plan_verify 0 BLOCKERs), plan-critic + scope-auditor hardened (5 scope gaps + 7 critic findings folded in), ND-1..ND-5 **user-approved**. W0 interface freeze DONE + reviewed: `macos/Spectra/DaemonCore/DriverProtocol.swift`.

**7 parallel Sonnet implementers dispatched. Status (all work UNCOMMITTED on disk):**
- ✅ S1 (ConnectOps, FakeDriver, SessionStore, SessionOps) — DONE
- ✅ S2 (BridgeClient, NativeDriver, RoleNormalize, SnapshotSerialize, SnapshotOps, ActOps, ComputerUseOps) — DONE
- ✅ S3 (Resolve, Actions, StepOps, Intelligence, AnalyzeOps, DiscoverOps) — DONE (byte-parity verified: analyze=0.781, discover captures=1 via reproducing TS's PNG colorType-4 silent-fail gate; no LLM anywhere; typecheck clean except the known S6 SocketServer timeout)
- ✅ S4 (CaptureOps, RecordingOps, FfmpegProbe) — DONE
- ✅ S5 (TerminalOps, CastParser) — DONE
- ✅ S6 (Router, SocketServer, ProxyClient, HandlerRegistry, main — the dispatch plane) — DONE
- ❌ S7 (gate harness: external-mode g2 gate, fixture-context, front-door options, payload-generator fake target, `verify-g2-suite.ts`, `verify-g2-ondevice.{sh,ts}`) — **NOT LANDED; re-dispatch it** (files not on disk)

**6/7 implementers DONE (S1–S6). Only S7 (gate harness) is unlanded — re-dispatch it first.**

## Integration TO-DO (next session, in order)
1. **Re-dispatch S7** (gate harness — brief in `.handoff.md` §S7): `external-mode.ts` (milestone-env-gated g2 allowlist, keep SWIFT_G1 export name + default byte-identical), `fixture-context.ts` (fake: seeding), `front-door.ts` (append-only routingConfig+extraEnv options, keep v1-pinned default), `payload-generator.ts` (fake: target case), `verify-g2-suite.ts` (V-A + V-B with the pre-ruled G2 volatile-field map, each chain includes the G1 31/31 arm), `verify-g2-ondevice.{sh,ts}` (V-C scaffold — launchd-context TCC spike first). Confirm the 4 importer test files need ZERO edits.
2. **Fix the known compile blocker:** `SocketServer.swift` lines ~101-105 — the routing-config log string is a 5-part `+` concat that hits Swift's "expression too complex to type-check" timeout. Split it into separate `FileHandle.standardError.write` calls or build with an array `.joined`.
3. **Reconcile the FakeDriver id scheme (V-B parity):** S1's FakeDriver emits `e1/e2` element ids (per the W0-frozen "sequential e1..eN" contract) but TS `tests/conformance/lib/fakes.ts` uses `el-1/el-2`. V-B byte-compares Swift-vs-TS on the same fixtures → this deterministic divergence FAILS unless reconciled: make the Swift FakeDriver match `fakes.ts` (`el-1/el-2`), OR add element-id normalization to the V-B comparator (Advisor ruling — it's not in the pre-ruled volatile map).
4. **Full-module compile:** `swiftc macos/Spectra/DaemonCore/*.swift -o /tmp/g2` → resolve residual cross-agent seams. (Cross-file SourceKit "Cannot find type" diagnostics during the build are noise — they resolve at module compile.)
5. **Run headless gates** via `verify-g2-suite.ts` (S7): V-A (FakeDriver conformance) + V-B (differential TS-vs-Swift, **3 consecutive green chains, each including the G1 31/31 arm**). Expect the G1-style convict-and-iterate arc — the pre-ruled G2 volatile-field map (§Verification) should pre-empt most whack-a-mole; any new volatile path = stop + Advisor ruling (don't self-mask). Route real proxy/daemon divergences to the owning S-agent.
6. **THEN V-C on-device gate — REQUIRES THE USER PRESENT.** Step 1 = the TCC-attribution spike, which MUST run under the launchd production context (a dev-shell run is a FAILURE). Then the 9 scripted steps (real AX/screenshot/recording + step/llmStep/observe/analyze against the repo TestApp), red/green evidence to `.build-loop/flip-evidence/`.
7. **THEN commit (C10) + Gate E2** (T-28 live soak + rollback drill v2→v1).

## Deferred scope (follow-ups, flagged honestly by implementers — NOT blockers to headless-green)
- **computerUse vision-pixel-grounding fallback** unported (S2) — AX-first path done; surfaces `needsVisionFallback:true` honestly; `TODO: Iteration N` in ComputerUseOps.swift.
- **screenshot region/auto framing** simplified (S4) pending S3's intelligence port — `TODO(iteration N, post-S3-merge)` in CaptureOps.swift; falls back to full-frame.
- **replayTerminal error-taxonomy** (S5): empty/unreadable cast, malformed header, bad regex → `internal_error`/500 (mirrors TS's generic catch), NOT `bad_request`/400. Confirm S7's V-B comparator agrees; if it expects 400, that's the divergence to resolve.

## Recurring friction to fix at the source (backlog)
- **plan-format regression:** every Fable advisor pass rewrites the Activation Map as a table and buries `parallel_batch` in a fence, re-breaking `plan_verify.py` (needs inline-key bullets + a non-fenced `parallel_batch` token). Hand-fixed ~6× this session. Fix: teach the advisor agent the plan_verify format, or relax the rule.
- **flip-g1 bind-wait:** `flip-g1.sh`/`rollback-g1.sh` use a 1s socket-bind wait that false-negatives on the slower node daemon (bump to ~5s).
- **dual-run soak instrument** hashes the FULL envelope → flags every native op as divergent on expected non-contract metadata (caller/deliveryPath/daemonVersion). Mask that metadata so the soak log becomes useful.
