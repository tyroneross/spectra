# Advisor ruling 2 — G2 chain-3 createSession non-determinism + D1 harness gap

status: RULED (Advisor, Frontier/Fable, 2026-07-03) · **Amendment 1 applied (same day — see §Amendment 1: B-e2e exclusion site reconciled to verify-flip-suite.ts; TWO scope-pinned frozen-file edits now authorized, not one)**
mode: re-plan (diagnosis: planning-miss — a pre-existing G1 gate-recipe fragility, exposed by the G2 3-chain requirement; product code for createSession-web is unchanged and routing was verified correct via the T-24 target-split arm)
inputs: `.build-loop/flip-evidence/g2-vb-chain3-createSession-ruling-request.md` · `/tmp/g2-chain3.log` (rows :17-61, :101-102, :179, :359-370, :596, :936-937, :1011) · `docs/plans/m3-g2-vb-advisor-ruling.md` (ruling 1) · plan §Locked Decisions / §Out-of-scope (SG-5 list)
extends: ruling 1 (Item 5 already ruled createSession has no valid headless TS cross-leg comparison basis; this ruling extends that finding to the two remaining gates that still byte/ok-compare it)
verified_by: plan-critic + scope-auditor (pending re-run on this delta)
acceptance reset: after these fixes land, the T-21 3-consecutive-green-chain count restarts at zero (unchanged contract from ruling 1).

Standing rule re-affirmed: **a mask/exclusion may never hide a semantic divergence — every exclusion below names its surviving floor.**

---

## Item 1 — Gate B-diff createSession chain-3 flake (verify-flip-suite.ts / front-door.ts)

**Verdict: real-Chrome non-determinism CONFIRMED; a classed ok-divergence treatment is AUTHORIZED for `createSession` in Gate B-diff — implemented as an APPEND-ONLY opt-in so the G1 gate's default semantics stay byte-identical for every other op and every other caller.**

**Evidence basis (✅ verified by code + log read):**
- The failing compare is front-door.ts `runDifferentialCheck`'s proxied branch (:953-1101): 3 spaced direct calibration samples + 1 proxy call, status equality (:1060), masked byte-equality, and a masked-path presence guard.
- Chain-3 row (g2-chain3.log:1011): `direct=500 proxy=200`; the divergence is `[error, ok, result]` — an ok-ness FLIP across identical requests to the SAME TS backend. Both legs carry `caller`/`deliveryPath` (visible in the printed bodies) — **the tunnel was byte-transparent; the backend itself answered differently.** Every createSession call here launches a real headless Chrome (~5s); launch/nav intermittently fails. Chains 1 & 2 passed because all four calls agreed on ok-ness (calibrated-volatile `[error.message, timestamp]` shows the direct samples were error responses whose free-text message the mask absorbed).
- corpus.test.ts already classes createSession `byte-diff N/A: real-Chrome/stateful` (:191, :229) — G1's own machinery ruled this op's outcome non-deterministic; Gate B-diff byte-comparing it as deterministic was a pre-existing fragility, same family as the Gate-A corpus basis error the C8 reconciliation fixed.
- The proxy is op-agnostic bytes-in/bytes-out for tunneled ops: a byte-infidelity bug cannot hide behind this one op — 29 other proxied-op byte-diffs still convict it every chain.

**Authorized treatment (class `real-chrome-stateful`, createSession ONLY, never generalized):**
When — and only when — the classed option is passed AND the four responses (3 direct calibration + 1 proxy) do not all agree on ok-ness, the cross-leg status-equality + masked-byte-equality + masked-path-presence checks are replaced by the floor below, and the run's mask ledger records a `real-chrome-stateful` divergence event (op, per-response ok/status, which leg(s) failed). **If all four responses agree on ok-ness (the case in chains 1 & 2), the existing full masked byte-diff runs UNCHANGED and still convicts.**

**Surviving floor — what stays asserted on EVERY run, so a real createSession routing regression still convicts:**
1. **Tunnel/route fingerprint, unconditional:** `caller` + `deliveryPath` + `timestamp` PRESENT on BOTH legs (the existing :1073-1077 checks stay). A front door secretly serving a web-target createSession natively omits them → FAIL. This is also the error-provenance discriminant: a proxy-SYNTHESIZED error lacks the TS envelope fields; a backend-originated error carries them.
2. **Per-response coherence:** each response parses as a JSON object / spec-valid envelope; status↔ok coherence (200 ↔ ok:true) per leg.
3. **Error taxonomy:** any error leg's `error.code` must be in createSession's declared errorCodes (a taxonomy regression convicts even mid-flake).
4. **Latency-parity bound and content-type equality stay.**
5. **Matched-okness byte-diff:** whenever the backend behaves deterministically within a run, full masked byte-equality convicts as before.
6. **Ledger visibility:** the divergence event is persisted with the masks evidence; a PERSISTENT one-sided pattern (proxy leg always failing while direct passes, across chains) is a FINDING for the Fable group verdict, never silently absorbed.
7. **External floors already green this chain:** T-24 `web-target createSession tunnels through front door (not served native)` (log:19 — response carries the tunneled TS Chrome-error page, 13 elements) and T-24 `native createSession(fake:)` (log:17); V-A contract shape-check (createSession in the g2 allowlist); V-B Swift-leg absolute assert vs the ADR-06 seed (green ×3, log:102/:522/:937).

**Who may edit what (verify-flip-suite.ts is effectively frozen — resolved; edit count updated by Amendment 1):**
- `tests/conformance/lib/front-door.ts` is **S7-owned** (plan owned_files). SG-2's append-only discipline is honored: a NEW optional field on `runDifferentialCheck`'s opts (e.g. `okDivergenceClass?: 'real-chrome-stateful'`) plus a branch that fires ONLY when the option is passed. Default behavior byte-identical for all existing callers — the G1 regression contract stays literally true.
- `macos/Spectra/DaemonCore/verify-flip-suite.ts` is G1-frozen by convention (G1 S4-owned; unowned in the G2 partition). **This ruling (as amended) assigns S7 exactly TWO scope-pinned amendments — nothing else in the file may change:**
  1. gateBDiff op loop: pass the classed option when `op === 'createSession'` + doc comment citing this ruling and g2-chain3.log:1011 (applied).
  2. gateBE2E result-set classifier: the createSession-row basis exclusion (§Amendment 1 — exact insertion point + matcher there).
  Precedent: the C8 corpus.test.ts amendment — a Fable-ratified basis-error correction to a frozen G1 gate — is the same class of change.

**Adjacent authorization (same class, Gate B-e2e):** the B-e2e result-set equality has the same latent exposure — a conformance-arm or corpus-arm createSession row that splits direct-pass/proxy-fail on a Chrome flake falls to the hard-failure "proxy bug" branch (it is not the recordLlmUsage GV-2 arm) → false-RED, resets the chain count. Both-fail is already excluded (`backend-capability`) and direct-fail/proxy-pass is tolerated — ONLY the direct-pass/proxy-fail split is exposed. Authorized: createSession rows enter the excluded set UNCONDITIONALLY under class `real-chrome-stateful` — the same "not a valid comparison regardless of outcome" argument as GV-1's native-route-corpus-basis exclusion (a real-Chrome launch outcome is not implementation-comparable). This is basis-exclusion, not plausibility-exclusion, so GV-2's order-swap discipline is not triggered. Floor: item-7 floors above + B-diff's fingerprint checks. **Implementation site: verify-flip-suite.ts gateBE2E (NOT verify-g2-suite.ts) — see §Amendment 1.**

## Item 2 — corpus createSession under milestone=g2 (SG-5)

**Verdict: option (b)'s INTENT — conformance widens, corpus does not — achieved at the HARNESS INVOCATION layer. No SG-5 exception needed. No protected file is edited. Options (a) and (c) are REJECTED.**

**Grounding (✅ verified by code read):**
- external-mode.ts reads `SPECTRA_CONFORMANCE_MILESTONE` **once at module load, per process** (:115, doc :103-115). corpus.test.ts:224's shapeOnly skip consults `SWIFT_G1_VERIFIABLE_OPS` — whatever set the SPAWNING process's env resolved.
- verify-g2-suite.ts ran all 4 importer files in ONE vitest invocation with `SPECTRA_CONFORMANCE_MILESTONE: 'g2'` (:549-554) — that single env decision is what un-skipped corpus createSession.
- The milestone widening affects corpus.test.ts through EXACTLY ONE path: the shapeOnly branch (:224). Every non-shapeOnly external entry is governed by the swift-native-corpus rule (`isSwiftNativeOp ? … : true`) regardless of the allowlist, and `listSessions` is already in the G1 set. So running corpus WITHOUT the milestone env loses nothing except the invalid createSession ok-ness arms.
- The assert being removed is invalid on its own terms: the corpus recorded a WEB-target createSession (TS, real Chrome + record → ok:false for [full]); corpus.test.ts:246 REGENERATES the payload via validPayloads, and payload-generator.ts:106 rewrites target→`fake:conformance-seed` under g2 — so the replayed request is not the recorded request, against a different implementation, for an op whose recorded outcome is itself real-Chrome non-deterministic. `[minimal]` passing today (ok:true==ok:true) is coincidence, not coverage.

**The fix (S7, verify-g2-suite.ts only — applied):** split the V-A invocation at :549-554 — run `corpus/corpus.test.ts` in its OWN vitest invocation that byte-mirrors Gate A's proven-green corpus recipe: `SPECTRA_CONFORMANCE_MILESTONE` explicitly DELETED from the child env (not merely un-set — `{...process.env}` inherits) and `SPECTRA_CONFORMANCE_SEED_SESSION=conformance-seed` set (Tier-2 branch, no wire seeding). The other 3 files keep `milestone=g2`. corpus createSession then skips with its ORIGINAL G1 `externalSkipReason` (the original rationale — web-recorded, unreplayable on a driverless standalone daemon — still holds verbatim).

**Why not (a):** an SG-5 exception (editing corpus.test.ts:224) is not needed when an S7-owned lever produces the identical semantics; SG-5 is a user-approved constraint and is preserved intact.
**Why not (b)-as-a-new-export:** a `SWIFT_G2_CONFORMANCE_ONLY` set cannot reach corpus.test.ts without changing which name corpus.test.ts imports — itself an SG-5 edit. Unavailable without the exception (a) avoids.
**Why not (c):** scoping payload-generator's target-override cannot distinguish its caller (both test files call `validPayloads` with the same env), and even if it could, keeping the web target on a STANDALONE daemon makes `[minimal]` (recorded ok:true) fail → it would need skipping anyway. Fails on its own terms.

**Surviving floor for the skipped arms:** V-A conformance shape+success check of createSession (fake:, g2 allowlist) · V-B Swift-leg absolute assert vs the ADR-06 seed spec · T-24 target-split arms (native fake: + tunneled web — the actual ND-3 detector, green log:17/:19) · **C11** (post-flip Swift-baseline corpus refresh) restores corpus coverage on a VALID same-implementation basis — that is the durable fix; this skip is the bridge.

## Item 3 — getRecording V-A D1 guard (fixture-context.ts)

**Verdict: fix direction CONFIRMED, with one correction — gate on the existing `milestoneG2` module const, not on `SPECTRA_CONFORMANCE_SEED` (a daemon-side env var not reliably present in the suite process's env).**

**Grounding (✅ verified):** RecordingOps.swift:498 seeds `conformanceSeedRecordingId = "conformance-seed-recording"`. fixture-context.ts:249 sets `recordingId: endpoint.recordingId` — undefined for the V-A external endpoint (Tier-2 recording seeding deliberately absent, doc :165-169), so payload-generator.ts:95 falls back to `'unknown-recording-id'` → not_found → the D1 success-path guard REDs (log:35). fixture-context.ts's own g2 doc comment (:172-174) already encodes the presumption "under the g2 milestone gate, the external daemon is a Swift daemon-core running with SPECTRA_CONFORMANCE_SEED=1" — the milestone const IS the right gate.

**SG-5 check: fixture-context.ts is NOT protected.** The SG-5 zero-edit set is exactly {conformance.test.ts, capability-gate.test.ts, external-mode.test.ts, corpus/corpus.test.ts}; fixture-context.ts is a lib in S7's owned_files. ✅

**Exact edits (S7, fixture-context.ts — applied):**
1. After `fakeSeedTarget()` (:156-158), add the mirror helper:
   `function seedRecordingId(): string { return process.env.SPECTRA_CONFORMANCE_SEED_RECORDING ?? 'conformance-seed-recording' }`
   (env-overridable default, same pattern as `SPECTRA_CONFORMANCE_FAKE_TARGET`; the literal must match RecordingOps.swift:498).
2. Line 249: `recordingId: endpoint.recordingId ?? (milestoneG2 ? seedRecordingId() : undefined),`

Default-mode invariance: milestone unset → byte-identical behavior (T-20's default-mode falsifier untouched). Blast radius: V-A g2 run only — V-B already passes the explicit id (verify-g2-suite.ts:1392); Gate B-e2e runs milestone-unset (its both-legs-fail D1 row stays in the excluded set, unchanged); Gate A unaffected.

---

## Amendment 1 — B-e2e createSession exclusion: site correction + second pinned edit (Advisor, 2026-07-03)

**Failure evidence preserved (coordinator-surfaced contradiction, implementation-time):** work-list #3(b) as originally written assigned the B-e2e createSession exclusion to verify-g2-suite.ts, but the gateBE2E() comparator + excludedSet classifier lives in **verify-flip-suite.ts** — verify-g2-suite.ts only re-runs that suite as an opaque subprocess and never touches its comparison logic — while Item 1's "who may edit" clause pinned verify-flip-suite.ts to EXACTLY ONE change. The two clauses could not both be satisfied. The exposure is real and load-bearing (✅ verified against the gateBE2E classifier): a createSession row with direct-PASS + proxy-FAIL is not the recordLlmUsage GV-2 arm, so it falls through to the hard "proxy bug" failure branch → false-RED → 3-chain count reset. Both-fail is already excluded (`backend-capability`); direct-fail/proxy-pass is tolerated; ONLY the direct-pass/proxy-fail split is exposed.

**Ruling: the SECOND scope-pinned verify-flip-suite.ts edit is AUTHORIZED.** Accepting the residual split-flake risk is REJECTED — a known, pre-classed non-determinism that can zero the chain count is exactly what this ruling exists to close, and leaving it open invites silent "re-run until green" pressure worse than a documented basis exclusion.

**(a) Exact insertion point + matcher shape (S7, gateBE2E result-set loop):** immediately AFTER the GV-1 `corpusArmNativeOp` exclusion block (the `if (nativeCorpusOp !== undefined) { … continue }` block) and BEFORE the `directPass`/`proxyPass` computation, mirroring GV-1's exact pattern (unconditional check → push to `excludedSet` → `continue`):

```ts
// Advisor ruling-2 Amendment 1: createSession rows are excluded from the
// equality basis UNCONDITIONALLY (class 'real-chrome-stateful') — a real-
// Chrome launch outcome is not implementation-comparable (same basis
// argument as GV-1 above; corpus.test.ts's own "byte-diff N/A: real-Chrome/
// stateful" label). Basis-exclusion, not plausibility-exclusion — GV-2's
// order-swap discipline is deliberately NOT triggered.
if (isCreateSessionRow(name)) {
  excludedSet.push({ test: name, directStatus: d, proxyStatus: p, class: 'real-chrome-stateful' })
  continue
}
```

with the matcher (both arms, nothing else) defined alongside `corpusArmNativeOp`:

```ts
const CONFORMANCE_ARM_CREATESESSION_PREFIX =
  'conformance oracle — socket-level contract conformance (all 30 ops) operation: createSession '
function isCreateSessionRow(testFullName: string): boolean {
  return (
    testFullName.startsWith(`${CORPUS_ARM_PREFIX}createSession [`) ||
    testFullName.startsWith(CONFORMANCE_ARM_CREATESESSION_PREFIX)
  )
}
```

Matcher grounding (✅ verified): conformance.test.ts's outer describe is `conformance oracle — socket-level contract conformance (all 30 ops)` (:88) with nested `operation: ${operation}` (:94) — vitest flattens fullNames space-joined, the same convention `CORPUS_ARM_PREFIX` already relies on. The trailing space in the conformance prefix and the ` [` in the corpus prefix pin the match to the createSession op exactly; the D1 guard row (`… (all 30 ops) D1 guard: …`, :198), the top-level spec-coverage test (:89), and every other op's rows do NOT match.

**(b) Confirmed: BOTH arms are excluded** — conformance-arm (a real web createSession against the TS backend = the same real-Chrome launch on each leg) and corpus-arm (already `byte-diff N/A: real-Chrome/stateful` by corpus.test.ts's own label). Unconditional, regardless of outcome.

**(c) Reconciliation applied to this document:** work-list item moved from verify-g2-suite.ts to verify-flip-suite.ts (#2b below); Item 1's "who may edit" clause now authorizes exactly TWO scope-pinned verify-flip-suite.ts changes (gateBDiff dispatch + this gateBE2E classifier insertion). Anything further in that file remains frozen and requires a fresh ruling.

**Surviving floor for the B-e2e exclusion (unchanged from Item 1):** createSession routing conviction lives in Gate B-diff's unconditional fingerprint floor + the T-24 target-split arms; tunnel byte-infidelity conviction lives in the 29 other ops' B-diff byte-diffs, B-diff's matched-okness createSession byte-diff, and B-e2e's equality basis over every other op; contract-shape conviction lives in V-A. The excluded rows remain VISIBLE in the excluded-set report (class `real-chrome-stateful`) for the Fable group verdict — count monotonicity must be explained there per the existing Excluded-set audit Q-criterion.

---

## Fix work-list (owned files + exact edits — orchestrator fans out; ONE wave, all S7, disjoint files from S1–S6) — AS AMENDED

1. **S7 — `tests/conformance/lib/front-door.ts`** (owned; SG-2 append-only honored) — **applied**: append optional `okDivergenceClass?: 'real-chrome-stateful'` to `runDifferentialCheck` opts; new branch fires only when passed AND the 4 responses' ok-ness is mixed → replace status-equality/masked-byte-diff/mask-presence checks with the Item-1 floor (fingerprint presence both legs · per-response envelope + status↔ok coherence · error.code ∈ declared taxonomy · latency + content-type kept) + persist a `real-chrome-stateful` event in the masks evidence. All-agree ok-ness → existing path unchanged. Default (option absent) byte-identical for every caller.
2. **S7 — `macos/Spectra/DaemonCore/verify-flip-suite.ts`** (G1-frozen; TWO Advisor-authorized scope-pinned amendments — this ruling + Amendment 1 are the authorization; nothing else in the file may change):
   a. **applied** — gateBDiff op loop: pass `okDivergenceClass: 'real-chrome-stateful'` for `op === 'createSession'` only, + doc comment citing this ruling and g2-chain3.log:1011.
   b. **NEW (was mis-assigned to verify-g2-suite.ts in the original work-list — see §Amendment 1)** — gateBE2E: insert the `isCreateSessionRow` matcher + unconditional `real-chrome-stateful` excludedSet push immediately after the GV-1 `corpusArmNativeOp` exclusion, per Amendment 1's exact shape.
3. **S7 — `macos/Spectra/DaemonCore/verify-g2-suite.ts`** (owned) — **applied**: split the :549-554 V-A invocation — corpus/corpus.test.ts in its own vitest run with `SPECTRA_CONFORMANCE_MILESTONE` DELETED from the child env + `SPECTRA_CONFORMANCE_SEED_SESSION=conformance-seed` (Gate-A corpus recipe); conformance/capability-gate/external-mode keep `milestone=g2`. *(The former #3(b) B-e2e item moved to #2b by Amendment 1.)*
4. **S7 — `tests/conformance/lib/fixture-context.ts`** (owned; NOT SG-5) — **applied**: the two Item-3 edits (seedRecordingId helper + line-249 fallback under milestoneG2).
5. **SG-5-protected — ZERO edits, verified by the existing CI grep Q-criterion:** conformance.test.ts, capability-gate.test.ts, external-mode.test.ts, corpus/corpus.test.ts. No exception invoked by this ruling or its amendment.
6. **Then:** V-A re-run → full V-B ×3 FRESH chains (count reset) → Fable group verdict. Any NEW divergence outside this ruling + ruling 1 + the plan's pre-ruled map = stop-and-rule, as before.

**Deferred-scope ledger (no new entries):** the TS not_found taxonomy and error-envelope optional-metadata notes from ruling 1 stand; C11 remains the durable corpus-coverage restoration for createSession.
