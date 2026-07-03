# Advisor ruling — G2 V-B/V-A chain-1 failure partition (8 items + minors)

status: RULED (Advisor, Frontier/Fable, 2026-07-03)
inputs: `.build-loop/flip-evidence/g2-vb-chain1-partition.md` · `.build-loop/flip-evidence/g2-t21-masks.json` · `/tmp/g2-chain1.log` · plan §"G2 volatile-field map" + §Verification (V-B)
extends: the plan's pre-ruled volatile-field map (docs/plans/m3-g2-plan.md rev 2). Anything not ruled here remains stop-and-rule.
verified_by: plan-critic + scope-auditor (pending re-run on this delta)
acceptance reset: after fixes land, the T-21 3-consecutive-green-chain count restarts at zero.

Standing rule re-affirmed for every `volatile` verdict below: **a mask may never hide a semantic divergence** (element count, role sequence, labels-after-id-normalization, bounds tuples, enabled/actions type parity). Each volatile verdict names how its floor survives.

---

## Item 1 — createSession.sessionId

**Verdict: test-recipe-bug** (S7 harness).

**Rationale:** The pre-ruled `generated-id` normalization exists in the comparator (`normalizeVolatileIds`, verify-g2-suite.ts:643) but the createSession compare is invoked with an **empty** knownIds map (`compareG2Op('createSession', …, new Map())`, verify-g2-suite.ts:913) — neither leg's freshly-returned sessionId is registered before comparing. The plan's map row (createSession · `generated-id` cross-leg NORMALIZATION) is authorized and simply unwired. ✅ verified by code read.

**Corrected instruction:** Absorbed into Item 5's restructure of the createSession arm (below). If any cross-leg createSession body compare remains, S7 builds knownIds from both legs' returned sessionIds (`{tsId→'<SESSION>', swiftId→'<SESSION>'}`) before `compareG2Op`, with the pre-ruled guard (non-empty string, referentially consistent within its leg).

## Item 2 — discover.manifestPath / outputDir

**Verdict: SPLIT — volatile (temp-HOME root) + REAL (storage-layout divergence, S1).**

**Rationale:** The two legs run under different temp homes by construction (`spectra-conformance-home-*` vs `spectra-g2-vb*-home-*`) — cross-leg byte-equality of absolute paths is impossible; the rev-3.5 `temp-path` class is the right treatment for the ROOT. But the evidence shows a second divergence a blanket mask would have hidden: TS writes `<home>/.spectra/sessions/<id>/discover/manifest.json`, Swift writes `<home>/sessions/<id>/…` — **the `.spectra/` segment is missing on the Swift leg** (g2-t21-masks.json, discover.detail). Under identical `HOME`/`SPECTRA_HOME`, Swift's storage-root resolution diverges from TS (the parity reference; `.spectra/` layout is documented product behavior — CLAUDE.md, and `.spectra/` is PROTECTED real data per Locked Decisions). Post-flip this would spray session artifacts into `~/sessions/`. This is exactly why the plan map said discover "none expected — flake = FINDING": the flake IS partly a finding.

**Corrected instruction:**
- **S7 (mask):** implement the temp-path treatment for `result.manifestPath`/`result.outputDir` as **home-root normalization, not path exclusion**: replace each leg's own home prefix with `<HOME>`, then byte-compare the remaining suffix. Floor preserved — the suffix compare is what convicts layout drift (it convicts today's `.spectra/` gap until S1 fixes it).
- **S1 (real fix):** SessionStore/StoragePath resolution must mirror TS byte-for-byte: sessions dir = `<resolved root>/.spectra/sessions/<id>/`. Falsifier: after fix, both legs' normalized `manifestPath` suffixes are byte-equal.

## Item 3 — recordTerminal.timeline[].time

**Verdict: volatile** — pre-ruled, wiring gap (S7).

**Rationale:** The plan map row rules `result.timeline` **structural (rev 3.3)**; rev 3.3's implementation in front-door.ts excludes the whole `result.timeline` subtree from byte-compare (`isUnderResultTimeline`, front-door.ts:774) and shape-asserts instead. The G2 comparator ported the shape assertion (verify-g2-suite.ts:1035-1056) but not the subtree exclusion — `classifyG2LeafPath` handles only `castFile`/`duration` for recordTerminal (:687-690), so `timeline[i].time` leaks into the byte compare. `.time` is masked-by-structural per the standing ruling. ✅

**Corrected instruction (S7):** in the recordTerminal arm, exclude `result.timeline` and everything under it from the byte compare (port `isUnderResultTimeline`); keep the both-legs shape assertion ({time:number, source, event:string}, non-empty). Floor preserved: `outputSize`/`lines`/`exitCode`/`fileChanges` stay fully byte-compared (they matched this run — a future flake there stays a FINDING, per the map row).

## Item 4 — V-A malformed-payload error taxonomy (11 ops)

**Verdict: REAL — dominant cause S6 (dispatch plane), secondary per-handler audit S1–S5.**

**Rationale:** The log shows the actual wrong code: `[missing:sessionId] error code "not_found" not in declared errorCodes ["bad_request", …, "internal_error", …]` (g2-chain1.log:62). Mechanism, verified in source: a session-scoped affinity op with a **missing/empty sessionId** falls through Router.swift:214 (`guard let sessionId … else { return .proxy }`) and, standalone, `.proxy` resolves `not_found` (SocketServer.swift:98 "no proxy backend configured — non-native ops resolve not_found"). That violates the plan's own pre-ruled clause SG-1a / Item 8: "decode failure on an affinity op = deterministic `bad_request`, never a silent tunnel" — a missing required routing identity IS a decode failure of the affinity envelope, not a store-miss. `computerUse`/`recordTerminal`/`replayTerminal` pass because they are `native:[]` and their handlers validate; `startRecording`/`getRecording` pass because their malformed variants carry a sessionId and fail on a different field inside the handler. `closeSession [full]`'s off-taxonomy `not_found` (log:96) is the same plane: a store-miss on an affinity op in **standalone** mode must dispatch native (Swift's store is the only store — that is what `SPECTRA_STANDALONE_SESSION_OPS=1` means), where SessionOps' close is already idempotent-ok (SessionOps.swift:65), matching TS.

**Corrected instruction:**
- **S6 (Router.swift + SocketServer.swift):** (a) in `resolveAffinity`, absent/empty/non-string `sessionId` (and `recordingId` for getRecording; unusable `target` for createSession) → deterministic `bad_request` BEFORE routing, mirroring TS fda8626 (bad_request AFTER the capability check — keep the ordering). This is correct in both topologies: with a backend, TS would itself answer bad_request, so parity holds. (b) Standalone opt-in mode: affinity store-miss → **native dispatch**, never proxy-not_found.
- **S1–S5 (per-handler, F-18 as planned):** audit each owned handler for non-sessionId required fields (act: elementId/action — S2; step: intent, llmStep: actions, walkthrough: steps — S3; screenshot modes — S4; replayTerminal: file — S5; createSession: target, closeSession/recordLlmUsage — S1) → `bad_request`, never a driver/store error escaping as `not_found`/`internal_error`. S7 audits (F-18).

## Item 5 — createSession elementCount 13 (ts) vs 2 (swift)

**Verdict: test-recipe-bug** (S7) **plus one adjacent REAL finding (routing/seed gate).**

**Rationale:** TS has no live fake createSession path — its createSession constructs a REAL CdpDriver (harness's own verified note, verify-g2-suite.ts:889-895). The TS leg was driven at `http://127.0.0.1:1/…` expecting failure; real Chrome instead rendered its network-error page (ok:true, 13 elements — ⚠️ INFERRED for the page identity; the load-bearing fact, real-CdpDriver-not-fixture, is verified). Comparing a live Chrome DOM against the 2-element ADR-06 seed violates V-B's own premise ("both legs drive identical deterministic fixtures") — the elementCount floor convicts only when the fixtures are comparable. The intended degrade-to-exclusion branch (:903) was defeated by the unexpected ok:true.

**Corrected instruction (S7):** the TS-leg createSession cross-comparison becomes a **permanent classed exclusion** (documented: no headless TS fake-createSession seam exists; remove or clearly quarantine the `127.0.0.1:1` probe). The Swift leg is asserted **absolutely against the ADR-06 seed spec** — stronger than cross-leg equality: `ok:true`, `elementCount === 2`, `platform === 'web'` (fakes.ts:73-76), sessionId non-empty generated-id. Swift-createSession contract shape stays covered by V-A (T-20); the real native path by V-C step 2. Floor preserved: elementCount is pinned to the known seed value, and snapshot/observe (same fixture both legs) already compare counts cross-leg (both 2 this run ✓).

**Adjacent REAL finding (from this run's corpus evidence, g2-chain1.log:137-153):** corpus replay of createSession[full] (a **web** URL target) against the standalone Swift daemon returned `ok:true` where the corpus recorded `ok:false`. Standalone has no backend, so ok:true means Swift **served a web-target createSession natively** — an ND-3/target-split violation (web must tunnel; the fake seam must key on the `fake:` prefix only, ADR-06 guard). Owner: S6 diagnoses the Router createSession target arm first (route origin log shows the leg); if the route is correct, S1's ConnectOps seed gate is over-reaching. T-24 also needs an explicit web-target createSession arm through the front door (S7 — the current gate has no target-split arm).

## Item 6 — T-23 boot-refusal: session-scoped op in plain native:[]

**Verdict: REAL — S6 Router.swift loader gap** (with the recipe interplay explained, no harness change required).

**Rationale:** Two verified causes: (a) `sessionCoupledOps` is still the G1 six — `listSessions, getSession, getRun, closeSession, closeAllSessions, recordLlmUsage` (Router.swift:109-111) — so `createSession` in `native:[]` passes the invariant, even though Router's own doc comment (:210-213) names snapshot…stopRecording as session-scoped; (b) the v1 standalone carve-out (`hasProxyBackend || !standaloneOptIn`, Router.swift:321-328) skips the check entirely under T-23's boot env (`SPECTRA_STANDALONE_SESSION_OPS=1`, no backend). Gate B2's arms pass because each of them makes the guard condition true (backend set, or flag unset). D-03 mandates fail-closed on "a session-scoped op in plain native:[]" for v2 — the invariant set never widened past G1.

**Corrected instruction (S6):** for **version-2 configs**: (a) the invariant set = the full session/recording-scoped canon (the D-03 affinity bucket's 17 ops + merge + fanout ops); (b) the standalone carve-out applies to **v1 configs only** (its purpose — the G1-verify all-11-native topology and the T-28 rollback drill — is v1-shaped; under v2 nothing legitimate puts a session op in plain `native:[]`). T-23's recipe as written then correctly refuses. v1 behavior byte-unchanged (G1 arm regression floor).

## Item 7 — caller/deliveryPath key-presence (DOMINANT class)

**Verdict: volatile — option (a): the comparator drops the keys.** Implementation is a harness bug (S7), not a new ruling.

**Rationale, all three candidates:**
- **(a) ADOPTED.** The ruling already exists in the comparator's own `ALWAYS_EXCLUDED_PATHS` doc (verify-g2-suite.ts:721-727): caller/deliveryPath are TS's OWN envelope fields (src/daemon/envelope.ts) that Swift's WireProtocol.swift never emits — "an EXPECTED, DOCUMENTED structural asymmetry", per the G1 rev-3.1 precedent (non-contract envelope metadata; front-door.ts:936-941 makes their ABSENCE the native route fingerprint). The failure is mechanical: the exclusion is applied via `maskPaths` (value substitution, :744/:780), which cannot mask a key that is **absent** on the Swift leg — `diffVolatilePaths` flags key-presence (`!(k in a) || !(k in b)`, front-door.ts:411) so the residual diff re-convicts `caller`/`deliveryPath` after "masking". Fix = delete-if-present on BOTH trees before the residual diff.
- **(b) REJECTED — factually unavailable.** The partition's premise ("the front-door wrapper adds them") is wrong: the V-B TS leg is `startConformanceDaemon()` direct — no front door in that leg. caller/deliveryPath come from the TS daemon's own envelope builder; G1's Gate B requires them present on the DIRECT TS leg too (front-door.ts:953-956). No boot mode of the TS daemon omits them.
- **(c) REJECTED — scope + mechanism damage.** Plan §Out of scope explicitly excludes "optional envelope metadata emission"; and Swift emitting caller/deliveryPath would destroy the T-22 route fingerprint (absence = native serve) that both G1's Gate B-diff and this gate's T-24 arms are built on.

**Corrected instruction (S7, verify-g2-suite.ts):** implement `dropKeys(value, {'caller','deliveryPath'})` applied to both legs before the residual diff in `compareG2Op` (:780) AND in the screenshot arm's residual check (:1085). `requestId`/`timestamp` stay value-masked (present on both legs). Floor preserved: only the two documented envelope-metadata keys are dropped; `ok`, `apiVersion`, `error.code`, and everything under `result.` remain compared. This single fix clears snapshot, observe, act, step, llmStep, walkthrough, analyze, screenshot, replayTerminal, and the caller/deliveryPath residue on createSession/discover/recordTerminal — note that after value-masking, **every one of the six-op class's result bodies already compared equal this run** (the ledger shows byte-identical masked bodies), which is a genuinely good parity signal.

## Item 8 — T-24 tunneled unknown-session: `internal_error` vs expected `not_found`

**Verdict: test-recipe-bug** (S7) **+ a plan-text correction (Advisor, this ruling).**

**Rationale:** The evidence falsifies the plan's claim, and the contract sides with the evidence: the declared errorCodes for these ops are `["bad_request","capability_denied","daemon_unhealthy","forbidden","internal_error","unauthorized","unsupported_api_version"]` — **`not_found` is not in the declared taxonomy** (g2-chain1.log:62); TS actually answers `internal_error: "Session … not found"` for a truly-unknown id, and the tunneled response carried `caller` (log:20) — i.e., the routing behavior T-24 exists to prove (byte-transparent tunnel on store-miss) WORKED. The plan's "TS answers not_found for truly unknown ids" (§Routing, ADR-04) was an unverified assumption, now corrected. Fixing TS's taxonomy is a TS-backend edit — out of G2 scope (strangler contract, §Scope "TS backend src/ is not modified"); it joins the replayTerminal error-taxonomy note in the deferred-scope ledger.

**Corrected instruction (S7):** replace the `error.code === 'not_found'` literal with **passthrough parity**: the front-door response for the unknown id must byte-equal a TS-DIRECT call with the same id (modulo requestId/timestamp), and `caller`/`deliveryPath` must be present (tunnel fingerprint). Advisor applies the plan-text correction (§Routing affinity row + ADR-04: "TS answers per its own taxonomy — observed `internal_error` — byte-transparent"); deferred-scope note logged for the TS not_found taxonomy question (user decision, M-scope).

---

## Minor A — stopRecording error-taxonomy arm (key order / both-ok)

**Verdict: test-recipe-bug** (S7). The arm handles only the both-legs-errored case (verify-g2-suite.ts:1006-1018); this run BOTH legs returned `ok:true {alreadyStopped:true, error:"No active recording for session <own id>"}` — semantically identical — and the arm dumped raw `JSON.stringify` (insertion order + envelope + per-leg embedded session id). **Never** require canonical key order from Swift's serializer — JSON key order is not contract; `canonicalJson` exists precisely for this. Fix: when both legs are `ok:true` (or both error), route through `compareG2Op` (canonicalJson + knownIds normalization handles the embedded ids + item-7's key-drop); keep code-equality for the mixed case.

## Minor B — auto-grown masks: observe.result.snapshot + llmStep.result.finalSnapshot

**Verdict: ACCEPT — conditionally.** Both are exact-path `embedded-content` hits inside the pre-ruled map's six-op row (classifyG2LeafPath:678) with typed guards executed. Condition: the plan's **PC-4 structural floor for masked embedded-content is mandated but NOT yet implemented** in the G2 comparator (only a non-empty-string guard runs today). S7 must wire it before these masks count toward a green verdict: parse both legs' serialized snapshot text (`[<id>] role "label" enabled, actions:[…], bounds:[…]` — src/core/serialize.ts line format) and assert element count, role sequence, labels-after-id-normalization, bounds numeric 4-tuples (non-negative w/h), enabled boolean + actions string-array type parity, value presence parity. A floor violation = REAL FAIL, never masked.

## Additional observed in this run's evidence (not in the 8, owners assigned)

- **recordTerminal V-A valid-payload 30s timeout** (log:82-84): REAL, **S5** — every contract-valid payload variant must terminate with TS-parity defaults/timeouts (V-B's fixed `echo` passes; a generator variant hangs the PTY).
- **getRecording D1 guard** (success path never exercised, log:117): REAL, known classed gap (harness :987-1004) — define the ADR-06 seeded recordingId. **S4** (recording-registry seed) + S1 (seed-hook plumbing) + S7 (harness consumes it).
- **V-A default-mode arm RED — getSession/getRun success never exercised, milestone UNSET** (log:171-181): ❓ undiagnosed; this is T-20's literal falsifier ("default-mode behavior change") and blocks the flip until root-caused. **S7 first**: diff the arm's boot/env/invocation against the GREEN G1-arm Gate A recipe (same binary is green there); escalate to **S1** if the ADR-06 seed-hook widening changed default-mode seeding.

---

## Fix work-list (MECE, ordered — orchestrator fans out from here)

1. **S7-harness — comparator/recipe corrections (one work item; owned file `macos/Spectra/DaemonCore/verify-g2-suite.ts` only):**
   a. Drop-keys (delete-if-present, both legs) for `caller`/`deliveryPath` before residual diffs in `compareG2Op` and the screenshot arm (Item 7).
   b. createSession arm restructure: TS-leg = permanent classed exclusion; Swift leg asserted absolutely vs the ADR-06 seed (ok:true · elementCount===2 · platform==='web' · generated-id guard); remove/quarantine the `127.0.0.1:1` probe (Items 5+1).
   c. recordTerminal: exclude the `result.timeline` subtree from byte-compare (shape assertion stays; deterministic siblings stay compared) (Item 3).
   d. discover: home-root normalization for `manifestPath`/`outputDir` — normalize the temp-HOME prefix to `<HOME>`, byte-compare the suffix (Item 2, mask half).
   e. Error-taxonomy arm: both-ok (and both-error) → `compareG2Op` with canonicalJson + knownIds; mixed → code equality (Minor A).
   f. PC-4 structural floor for embedded-content masks (parse + assert count/roles/labels/bounds/enabled/actions/value-presence) (Minor B condition).
   g. T-24 unknown-session: passthrough-parity assertion vs TS-direct + tunnel fingerprint; drop the `not_found` literal (Item 8).
   h. T-24: add the missing web-target createSession target-split arm (Item 5 adjacent).
   i. Diagnose the default-mode arm delta vs the green G1 Gate A recipe (report; escalate to S1 if real).
2. **S6 — dispatch plane (`Router.swift`, `SocketServer.swift`):**
   a. v2 loader: session-scoped invariant set = full D-03 affinity+merge+fanout canon; standalone carve-out scoped to v1 configs only (Item 6).
   b. Missing/empty `sessionId` (`recordingId`; unusable `target`) on a session-scoped affinity op = `bad_request` pre-route, after capability check — SG-1a/fda8626 mirror (Item 4, dominant).
   c. Standalone opt-in: affinity store-miss → native dispatch, never proxy-not_found (Item 4, closeSession[full] class).
   d. Diagnose web-target createSession routed native under seed (corpus ok-drift) — fix the Router target arm, or hand to S1(3b) if ConnectOps (Item 5 adjacent).
3. **S1 — session core (`SessionStore.swift`, `ConnectOps.swift`, `SessionOps.swift`):**
   a. Storage layout parity: sessions under `<root>/.spectra/sessions/<id>/` exactly as TS resolves it (Item 2, real half).
   b. ConnectOps fake seam gated on `fake:` target prefix ONLY (if 2d lands here).
   c. Verify closeSession/recordLlmUsage taxonomy after 2b/2c land (expected resolved by dispatch-plane fix; confirm, don't assume).
4. **S2/S3/S4/S5 — per-handler validation audit (F-18):** non-sessionId required fields → `bad_request` (S2: act/snapshot/computerUse · S3: step/llmStep/walkthrough/observe/analyze/discover · S4: screenshot/recording ops · S5: terminal ops); S7 audits.
5. **S4 (+S1 hook, +S7 harness): seeded recordingId per ADR-06 widening** — unblocks the getRecording D1 guard and the getRecording success-path V-B arm.
6. **S5: recordTerminal valid-payload termination parity** (V-A timeout).
7. **Advisor (this ruling): plan-text correction** — §Routing/ADR-04 "TS answers not_found" → observed `internal_error`, byte-transparent; deferred-scope note for the TS taxonomy question.

**Sequencing:** 1+2 in parallel (disjoint files) → V-A re-run → 3–6 → full V-B ×3 fresh (chain count resets) → Fable group verdict. No comparator change beyond this ruling's map extension; anything new that diverges = stop, Advisor ruling, as before.

---

## Addendum — wave-1 re-run outcome + error-envelope-metadata extension (orchestrator, 2026-07-03)

Wave-1 (S1 storage + S6 dispatch-plane + S7 comparator) landed; union compile exit 0; re-run collapsed the RED from ~20 divergences to 4, all in the deferred 3–6 wave: **(i)** corpus `createSession[full]` ok:true-drift (standalone web-target served native → S1 item 3b ConnectOps `fake:`-only gate; S6 confirmed Router routes web→tunnel correctly, so it is the ConnectOps seam, not routing); **(ii)** V-A `recordTerminal` valid-payload 30s PTY timeout → S5 item 6; **(iii)** V-A D1 guard `getRecording` success-path unexercised → S4 item 5 seeded recordingId; **(iv)** a NEW small V-B class below.

**New class — error-envelope optional metadata (`error.retryable`, `error.details`, `error.message`).** After S7 item (e) rerouted both-error arms through full-body `compareG2Op`, three arms (computerUse/startRecording/getRecording) diverge: `.code` matches everywhere; TS emits `retryable:false` always (`src/daemon/envelope.ts:47`) + structured `details` + verbose `message`, Swift emits only `code`+`message` (`WireProtocol.swift:126`) with terser wording.

**Verdict: volatile — comparator masks `error.message`, `error.details`, `error.retryable`; compares `error.code` + HTTP status only.** Grounded, NOT self-masking a bug: (1) the plan §Verification already pre-rules error comparison as **"code + status; message per existing free-text class"** — `message` was pre-ruled free-text, S7 simply didn't wire the class; (2) `retryable`/`details` are **optional** contract fields (`schemas.ts:576-577` `.optional()`) — a Swift error omitting them is contract-valid (V-A schema conformance does not flag them); (3) making Swift emit them is **"optional envelope metadata emission," explicitly §Out-of-scope** — the identical clause that rejected option (c) for caller/deliveryPath (Item 7). Floor preserved: `error.code` + status still fully compared (a wrong code = REAL FAIL). **Deferred-scope note (M-scope, user decision):** Swift error envelopes do not emit `retryable`/`details`; joins the TS-`not_found`-taxonomy (Item 8) and replayTerminal-error-taxonomy deferred ledger. S7 adds an `error-metadata` free-text/optional class (paths `error.message`/`error.details`/`error.retryable`).
