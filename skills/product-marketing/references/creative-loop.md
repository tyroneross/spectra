# Creative quality loop

This is the governing protocol for audience-specific marketing content. It turns a request into a bounded set of campaign artifacts, routes production through existing Spectra operations, and stops only when the result is ready to test or explicitly blocked.

## Governing principles

1. Start from the commercial job and viewer decision, not a feature list.
2. One campaign has one primary audience, one promise, one proof sequence, and one primary call to action.
3. Choose the shortest runtime that fully answers the viewer's current question.
4. Demonstration is stronger than assertion. Unsupported claims never progress to production.
5. Technical validity is necessary but does not prove creative effectiveness.
6. Derived assets reuse source footage, not necessarily the same narrative.
7. Stop after two audit-repair passes. Persistent blockers require a replan or missing evidence, not endless polishing.

## State model

```text
DEFINE → DIAGNOSE → CONCEPT → SELECT → EVIDENCE → STORYBOARD
       → PRODUCE → ENHANCE → AUDIT → READY_TO_TEST
                                      ↘ REPAIR (maximum 2) ↗

Terminal alternatives:
PLAN_READY · BLOCKED_MISSING_INPUT · BLOCKED_MISSING_EVIDENCE · PRODUCTION_FAILED · REPLAN
```

Advance only when the current state's exit gate passes. Record every transition in `manifest.json` with `from`, `to`, `reason`, and ISO timestamp.

## Campaign artifacts

When file writes are available, store the campaign at `.spectra/campaigns/<campaign-slug>/`. Otherwise return the same artifacts as named sections in the response.

| Artifact | Minimum contents | Written by |
|---|---|---|
| `manifest.json` | campaign ID, state, repair count, selected concept ID, paths, transitions, result | every transition |
| `creative-brief.md` | product, audience, trigger, alternative, desired action, channel, viewer question, success metric | DEFINE |
| `diagnosis.md` | friction, proposition, objection, proof inventory, magic moment | DIAGNOSE |
| `concepts.md` | three routes, scores, selection rationale | CONCEPT/SELECT |
| `claim-ledger.md` | claim IDs, exact wording, evidence state, source/shot, disposition | EVIDENCE |
| `script.md` | governing promise, hook, beats, CTA, spoken/on-screen copy | STORYBOARD |
| `storyboard.md` | timed visual and audio/text tracks, claim and proof IDs | STORYBOARD |
| `production-plan.md` | target, setup, shot list, capture/render operations, channel specs | STORYBOARD |
| `audit.md` | dimension scores, blockers, repair decisions, final result | AUDIT/REPAIR |

## Phase 1 — DEFINE

Resolve these fields from repo/product evidence before asking the user. Ask only for a field that materially changes the concept or acceptance test.

| Field | Required decision |
|---|---|
| Product | What is being marketed and what is available to show now? |
| Primary audience | Who should recognize themselves? Avoid “everyone.” |
| Trigger | What happened immediately before they seek a solution? |
| Current alternative | What do they do or tolerate today? |
| Desired action | One next step: notice, click, install, start, book, reply, or learn. |
| Distribution | Placement, device, aspect ratio, autoplay/sound context. |
| Viewer question | Why notice, why care, why believe, how it works, or how to become capable? |
| Success metric | The observable behavior that indicates progress. |

Exit gate: all eight fields are resolved or the campaign becomes `BLOCKED_MISSING_INPUT` with only the missing decision listed.

## Phase 2 — DIAGNOSE

Write one sentence for each:

- **Friction:** the concrete situation the viewer recognizes.
- **Proposition:** the product's relevant value, without unsupported superlatives.
- **Outcome:** the state after the demonstrated task.
- **Objection:** the main reason this audience may not believe or adopt it.
- **Proof inventory:** real workflows, product captures, measured data, customer language, testimonials, trust evidence, and successful outputs.
- **Magic moment:** the visual event where differentiated value becomes obvious.

Exit gate: the proposition connects the trigger to a meaningful outcome, and at least one producible proof path exists.

## Phase 3 — CONCEPT

Generate exactly three genuinely different routes. Do not relabel the same shot order.

| Route | Opening logic | Required proof pattern |
|---|---|---|
| `proof-led` | Lead with an impressive, relevant result or task | input → visible product action → verified result |
| `problem-led` | Make a familiar friction concrete | current alternative → cost/friction → product resolution |
| `transformation-led` | Contrast the before and after state | before → transition through product → after |

Each route must include: audience tension, hook, governing promise, magic moment, proof sequence, CTA, target placement, estimated duration, feasibility risks, and what makes it distinct.

## Phase 4 — SELECT

Score each concept from 1–5, then apply the fixed weights. The score is a repeatable decision aid, not a forecast of performance.

| Dimension | Weight |
|---|---:|
| Audience fit | 20 |
| Proposition clarity | 15 |
| Proof strength | 20 |
| Differentiation | 15 |
| Emotional relevance | 10 |
| Conversion alignment | 10 |
| Production feasibility | 10 |
| **Total** | **100** |

Formula: `weighted score = Σ(rating / 5 × weight)`. Select the highest score only if it has no fatal feasibility or evidence gap. Break ties by proof strength, then audience fit, then feasibility. Preserve all three routes in `concepts.md`.

## Runtime decision

Use the shortest format that answers the viewer's current question without rushing or padding.

| Viewer question / intent | Starting range | Typical content |
|---|---:|---|
| Why notice this? | 6–15 sec | one association, transformation, or result |
| Why care? | 20–120 sec | relevance, proposition, one proof point |
| Why believe it? | 2–8 min | complete workflow, evidence, objection handling |
| How does it work? | 3–15 min per task | task completion and verification |
| How do I become capable? | structured sequence | one learning objective per lesson |

Placement modifies the range: interrupted feed viewers grant seconds; intentional search, evaluation, and learning viewers grant time while the content keeps resolving their question.

## Phase 5 — EVIDENCE

Give every material claim a stable ID and exactly one evidence state.

| State | Meaning | Production rule |
|---|---|---|
| `directly_demonstrated` | The planned shot visibly proves the claim | allowed; name the shot ID |
| `supported_source` | A current product document, measurement, or other authoritative source supports it | allowed; cite the source |
| `customer_evidence` | An attributable testimonial or customer result supports it | allowed only with usage permission and attribution |
| `inferred` | The conclusion is reasonable but not directly proven | reframe as a hypothesis/possibility or obtain evidence |
| `unsupported` | No adequate support exists | remove; this is a blocking finding |

Claim-ledger columns:

```text
claim_id | exact_claim | importance | evidence_state | evidence_ref | shot_id | disposition
```

Exit gate: no material claim remains `unsupported`; no `inferred` statement is phrased as fact.

## Phase 6 — STORYBOARD

Build aligned visual and audio/text tracks. Every beat must advance comprehension, proof, emotion, or direction.

| Time | Visual / product action | Audio or on-screen text | Claim ID | Proof / shot ID | Purpose |
|---|---|---|---|---|---|
| `0:00–0:03` | what the viewer sees | what the viewer hears or reads | `C-01` | `S-01` | attention/relevance |

Rules:

- Show product early when the selected concept promises product proof; the 45–60 second default shows it within five seconds.
- Use 2–3 moments that matter, not a complete feature inventory.
- Pair spoken claims with visual support wherever possible.
- Keep interface text readable at delivery size.
- Use one CTA whose destination fulfills the video's promise.
- The script must still communicate its core message when autoplay is muted.

Exit gate: every material claim maps to evidence and a visual proof plan; duration fits the viewer question and placement.

## Phase 7 — PRODUCE

1. Confirm required Spectra operations exist before promising production.
2. Connect to the real target and prepare clean, representative demo data.
3. Capture a complete source workflow plus alternate takes for hook, proof, and CTA.
4. Record cursor telemetry when pointer motion matters; capture audio only when it will be used.
5. Preserve the clean source recording before derivative edits.
6. Register durable captures in the Spectra library when long-term reuse is intended.

If production cannot run, stop as `PRODUCTION_FAILED` with the failed operation, exact error, completed artifacts, and a paste-ready recovery step. Do not fabricate capture results.

## Phase 8 — ENHANCE

Apply edits in this order:

1. Remove slow introduction and redundant explanation.
2. Move the relevant result or tension earlier.
3. Emphasize the magic moment with framing, zoom, or spotlight only when it improves comprehension.
4. Make interface and captions readable at final size.
5. Clean or remove poor audio; never let audio carry information absent from the visual/text track.
6. Tighten the CTA and select a representative poster frame.
7. Export to the placement's aspect, duration, and technical contract.

## Phase 9 — AUDIT

Score each dimension from 1–5. Record one sentence of evidence for every score; do not score from intuition alone.

| # | Dimension | Audit question |
|---:|---|---|
| 1 | Audience specificity | Does the intended viewer recognize themselves? |
| 2 | Hook relevance | Does the opening attract the right viewer? |
| 3 | Proposition clarity | Can the value be repeated in one sentence? |
| 4 | Problem recognition | Is the current friction concrete? |
| 5 | Product visibility | Does the product appear at the right time and clearly? |
| 6 | Proof quality | Does the content demonstrate the claim? |
| 7 | Magic moment | Is the differentiated value visually obvious? |
| 8 | Outcome relevance | Does the result matter to the audience? |
| 9 | Credibility | Are claims believable and supported? |
| 10 | Emotional payoff | Does the viewer feel relief, mastery, curiosity, or possibility? |
| 11 | Comprehension | Can it be understood without extra explanation? |
| 12 | Channel fit | Is it designed for its placement and device? |
| 13 | CTA alignment | Is the next step clear and appropriate? |
| 14 | Conversion continuity | Does the destination fulfill the content's promise? |
| 15 | Measurement readiness | Can performance connect to the stated success metric? |

Interpretation:

- **65–75:** strong and eligible for `READY_TO_TEST`.
- **55–64:** promising, but repair identifiable weaknesses.
- **40–54:** understandable but unlikely to stand out or convert; replan after the repair cap.
- **Below 40:** return to concept strategy before further production polish.

A score never overrides a blocker. Blocking findings are:

- unresolved primary audience, desired action, or placement;
- material `unsupported` claim or factual wording backed only by inference;
- no visible/attributable proof for the governing promise;
- CTA or destination that breaks conversion continuity;
- unreadable or misleading product footage;
- invalid/corrupt output or failure to meet the required channel contract.

## Phase 10 — REPAIR and terminate

On each repair pass:

1. List every blocker and the three lowest-scoring dimensions.
2. Change the minimum shots, copy, evidence, or edit decisions needed to address them.
3. Re-render only affected derivatives.
4. Re-run the full audit with new evidence.
5. Increment `repair_count`.

Terminate as:

- `PLAN_READY` when planning was requested without production and the storyboard, evidence ledger, and production plan pass their exit gates.
- `READY_TO_TEST` when score is at least 65/75 and blockers are empty.
- `BLOCKED_MISSING_EVIDENCE` when required proof cannot be obtained honestly.
- `REPLAN` when blockers persist after two repairs, the score remains below 65, or the governing concept is wrong.
- `PRODUCTION_FAILED` when a required operation fails and the recovery step does not resolve it.

After launch, test one variable per experiment—hook, first visual, proposition, scenario, proof format, runtime, CTA, thumbnail, or audience segment—so the result remains attributable.

## Practical default and derivative ladder

For a new app, plugin, or AI tool with limited data, start with a **45–60 second, audience-specific, proof-led video showing one realistic task from input to verified result, with the product visible within five seconds and one low-friction CTA**.

Capture one complete 5–8 minute source workflow when feasible, then design distinct derivatives:

| Derivative | Job | Narrative rule |
|---|---|---|
| 6–10 sec magic moment | recognition | one result or transformation; withhold explanation |
| 15–30 sec teaser | curiosity/action | one hook, one reason to care, one CTA |
| 30–45 sec proof clip | credibility | complete one claim-to-proof arc |
| 60–120 sec overview | consideration | simplify the full proposition |
| 3–8 min demo | evaluation | prove the end-to-end task and handle the main objection |
| 3–15 min tutorial | adoption | teach one task to verified completion |

Do not create derivatives by speeding up or arbitrarily trimming the same edit. Reuse footage; redesign the story for the viewer question.
