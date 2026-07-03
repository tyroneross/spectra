# G2 V-B integration — chain-1 failure partition (for Advisor ruling)

Run: `node_modules/.bin/tsx macos/Spectra/DaemonCore/verify-g2-suite.ts`
Full log: `/tmp/g2-chain1.log`
V-B ledger: `.build-loop/flip-evidence/g2-t21-masks.json`
Plan pre-ruling: `docs/plans/m3-g2-plan.md` §"G2 volatile-field map (Advisor pre-ruling)"

## Integration state
- Both known blockers fixed: SocketServer string-concat split (compile), FakeDriver ids `e1/e2`→`el-1/el-2` (V-B parity confirmed live in log: `[el-1] button "Fake Element el-1"`).
- Full-module `swiftc *.swift` = exit 0, 0 errors, 0 warnings.
- **G1 31/31 regression arm GREEN** (verify-flip-suite full run incl Gate B-diff 31/31, Gate B-e2e, Gate C 31/31, Gate D mutation RED/GREEN bites, T-10 guard). No G1 regression.
- **RED is confined to the new G2 differential comparator (V-B) + the V-A error-taxonomy arm.**

## Ruling requested — partition each class volatile(→comparator/mask change) vs real(→S-agent fix)

### BUCKET 1 — suspected comparator not applying its OWN pre-ruled treatment
1. **createSession.sessionId** — plan pre-rules `generated-id` cross-leg normalization; comparator emits "unmasked divergence outside the pre-ruled G2 map: result.sessionId — stop, Advisor ruling required". Is the normalization simply unwired in verify-g2-suite.ts? Authorize the wiring?
2. **discover.manifestPath / outputDir** — differ only by temp HOME root (`spectra-conformance-home-*` vs `spectra-g2-vb2-home-*`). temp-path class exists (rev-3.5). Plan map says discover "none expected" — but these ARE temp paths. Rule: add temp-path mask for these two leaves, or treat as finding?
3. **recordTerminal.timeline[].time** — timing floats (0.0000071 vs 0.0000261). Plan rules timeline "structural, rev 3.3". Confirm `.time` leaf is masked-by-structural and wire it?

### BUCKET 2 — suspected genuine implementation gaps (confirm owner + fix direction)
4. **V-A malformed-payload error taxonomy** — many ops (act, analyze, discover, llmStep, observe, recordLlmUsage, screenshot, snapshot, step, walkthrough, closeSession) fail "malformed (missing-required-field) payloads never escape the declared error taxonomy". Plan Item 8 = "malformed → deterministic bad_request AFTER capability check for all 16 ops". `computerUse`/`startRecording`/`getRecording` DO return correct taxonomy. Which S-agent owns the boundary validation for the failing ops? (Dispatch plane S6 vs per-op S1–S5?)
5. **createSession elementCount 13(ts) vs 2(swift)** — Swift uses 2-element FakeDriver; TS leg returns 13. Plan structural floor mandates "element count equal". Is TS createSession(fake:) not honoring the ADR-06 seed (harness bug), or a real Swift divergence? Owner?
6. **T-23 boot-refusal: session-scoped op in plain native:[] — daemon BOUND instead of refusing.** Yet Gate B2 (i) `backend+flag+session-op-native→refuses` and (ii) `no-backend+no-flag+session-op-native→refuses` both PASS. What distinguishes T-23's recipe? Real S6 Router loader gap or test-recipe mismatch?

### BUCKET 3 — genuinely ambiguous, ruling drives different downstream work
7. **caller / deliveryPath key-presence (DOMINANT — snapshot, observe, act, step, llmStep, walkthrough, analyze, screenshot all fail ONLY on this).** After value-masking, TS envelope carries `caller`+`deliveryPath` keys; Swift native envelope omits them. Root: V-B boots the TS leg via `startConformanceDaemon()` (front-door attribution wrapper adds caller/deliveryPath) but the Swift leg standalone-native (no attribution layer). G1 established these as "expected non-contract metadata native ops don't emit". Three candidate fixes, each different work:
   - (a) comparator drops caller/deliveryPath keys (non-contract envelope metadata) — smallest, G1-precedented;
   - (b) boot the TS leg without the front-door wrapper so both legs are symmetric-native;
   - (c) Swift native ops SHOULD emit caller/deliveryPath (real gap). Which?
8. **T-24 tunneled unknown-session** → Swift proxies TS's `internal_error: "Session ... not found"`; test expects `not_found` passthrough. Swift faithfully tunnels TS. Is `not_found` the contract (→ TS backend fix) or is `internal_error` acceptable (→ test expectation fix)? (Matches the RESUME deferred-scope replayTerminal error-taxonomy note.)

## Also observed (minor)
- stopRecording error-taxonomy arm diverges on JSON KEY ORDER only (Swift emits result/timestamp/ok/apiVersion/requestId; TS alphabetical-ish). Canonical-key-order serialization on Swift side, or key-sorted compare?
- Harness auto-grew masks for observe.result.snapshot + llmStep.result.finalSnapshot (embedded-content, timestamps) — flagged for Fable review, not failures. Confirm accept.
