---
modifies_api: false
---

# Plan: Spectra Marketing Content Quality Loop

<!-- checklist
Item 1 — Auth guard: N/A: no server route or authentication change.
Item 2 — External APIs: N/A: no new external API calls; production uses existing Spectra tools.
Item 3 — Rate-limit criterion: N/A: no paid API call is introduced.
Item 4 — Discoverability: `/spectra:marketing <brief>` is the direct entry; `/spectra <marketing intent>` routes to it; no graphical UI is added in this run.
Item 5 — Server/client boundary: N/A: no server-side data fetching or client boundary change.
Item 6 — Concurrency: N/A: no new write endpoint; recording finalization remains inside the existing single-recording stop lifecycle.
Item 7 — Observability: Existing recording status and artifact events remain unchanged; campaign progress is exposed through named agent states and written campaign artifacts rather than a new telemetry path.
Item 8 — Input validation: N/A: no POST, PUT, PATCH, RPC, or public operation contract is added.
Item 9 — Stable ID traceability: U-01 → F-01 → D-01 → T-01; U-02 → F-02 → D-02 → T-02; U-03 → F-03 → D-03 → T-03.
Item 10 — JSON spec object: `## Spec Object (JSON)` defines interlinked needs, features, data points, tests, and ADRs.
Item 11 — Blocking-and-novel question gate: No open questions; reversible defaults are labelled as assumptions in Locked Decisions.
Item 12 — Low-reversibility ADRs: N/A: all changes are reversible; ADR-01 records why the current host-agent boundary is retained.
Item 13 — Analytical lens: QFD maps audience/content needs to capabilities and tests; AHP-style fixed weights select among concrete concept routes.
Item 14 — Handoff document: `docs/plans/marketing-content-quality-loop-2026-07-10.handoff.md` maps each F-ID to ADR-01 and T-IDs.
Item 15 — Synthesis dimensions: Assessment-only values are declared below solely because the plan records a deferred native surface; no UI file is modified.
Item 16 — Risk reason: N/A: no security, persistence, runtime protocol, deployment, or user-trust boundary applies.
Item 17 — UI input/output contract: The assessment-only row below makes every required dimension explicit and confirms that no UI input or output changes in this run.
Item 18 — Dispatch tier per work item: C1 script for a known commit port; C2-C4 sonnet for bounded agent-system judgment; C5-C6 haiku for tests and evidence-driven docs.
Item 19 — Env-var manifest: N/A: no new external service.
Item 20 — Capability gap map: Present in `## Capability Gap Map` and grounded in current source files.
Item 21 — Single-shot build guardrails: Present in `## Single-Shot Build Guardrails` with exact evidence.
Item 22 — Read-before-edit map: Present in `## Read-Before-Edit Map` with exact source and destination files.
-->

## Goal

Make Spectra reliably produce marketing-ready content by combining its existing capture/render strengths with a shipped, evidence-backed creative loop. The loop must define the audience and desired action, compare three concepts, select with fixed weights, plan proof at shot level, produce with existing Spectra tools, and repair quality blockers before stopping.

## Research context

- The two user-supplied research notes define the governing creative logic: commercial job first; attention, brand, connection, proof, and direction; three concept routes; claim validation; and a bounded audit loop.
- Google Ads' official ABCD guidance supports early attention, branding, connection, and a clear direction/CTA, while its objective-specific guidance supports varying the creative by campaign job.
- Apple's current app-preview specification limits previews to 15–30 seconds and at most 30 fps. Spectra may retain constant-frame-rate output as a house compatibility rule, but must not call constant 30 fps an Apple requirement.
- Wistia's first-party dataset supports choosing duration by goal and viewer intent rather than a single universal ideal.

## Locked decisions

- **Analytical lens: QFD + AHP-style weighted selection.** QFD maps user needs to workflow capabilities; a fixed weighted score compares the three concept routes without pretending to be statistically calibrated.
- **[ASSUMED: reversible and consistent with current plugin architecture]** Campaign state is a set of markdown/JSON artifacts under `.spectra/campaigns/<slug>/`, not a new daemon schema.
- **[ASSUMED: supplied research default]** The agent creates exactly three initial concept routes: proof-led, problem-led, and transformation-led.
- The agent may repair a campaign at most twice. It stops earlier when no blocking audit finding remains.
- Readiness is binary: score at least 65/75 and no blocking claim, proof, CTA, or technical-output defect.
- Native UI remains read-only until Rally clears the privacy-attribution blocker.

## Scope

- Port the unique finalization commit from `fix/recording-finalize-yuv420p` onto current `main` code and preserve its tests.
- Add a creative-loop reference and update the product-marketing skill.
- Replace the marketing planner prompt with an explicit production agent contract.
- Add a marketing command and refresh the `/spectra` router.
- Ship agents in the npm package and add structural contract tests.
- Add a durable assessment of current, output, branch, and native status.
- Update adjacent README discoverability.

### Out of scope

- Native SwiftUI implementation.
- New public runtime operations, campaign database, analytics provider, or video-generation service.
- Replacing the demo-render pipeline.
- Merging unrelated branches or modifying the dirty canonical checkout.

## Spec Object (JSON)

```json
{
  "needs": [
    {"id": "U-01", "priority": "P0", "statement": "Creators need recorded output that is technically playable and distribution-ready", "features": ["F-01"]},
    {"id": "U-02", "priority": "P0", "statement": "Creators need an audience-specific narrative and proof plan before capture", "features": ["F-02", "F-03"]},
    {"id": "U-03", "priority": "P0", "statement": "Host agents and package users need a deterministic and discoverable workflow", "features": ["F-03", "F-04"]},
    {"id": "U-04", "priority": "P1", "statement": "Maintainers need an honest current/native assessment and safe branch disposition", "features": ["F-05"]}
  ],
  "features": [
    {"id": "F-01", "priority": "P0", "name": "Recording finalization", "data": ["D-01"], "tests": ["T-01"]},
    {"id": "F-02", "priority": "P0", "name": "Creative quality protocol", "data": ["D-02", "D-03"], "tests": ["T-02"]},
    {"id": "F-03", "priority": "P0", "name": "Deterministic marketing planner", "data": ["D-02", "D-03", "D-04"], "tests": ["T-03"]},
    {"id": "F-04", "priority": "P0", "name": "Command and package discoverability", "data": ["D-04"], "tests": ["T-04"]},
    {"id": "F-05", "priority": "P1", "name": "Current/native assessment", "data": ["D-05"], "tests": ["T-05"]}
  ],
  "data": [
    {"id": "D-01", "semantics": "Finalized media path plus probe validation result"},
    {"id": "D-02", "semantics": "Creative brief, concept set, and selected concept score"},
    {"id": "D-03", "semantics": "Claim ledger, dual-track storyboard, audit score, blockers, and repair count"},
    {"id": "D-04", "semantics": "Agent command route and npm package file surface"},
    {"id": "D-05", "semantics": "Evidence-separated assessment with branch and native blocker status"}
  ],
  "tests": [
    {"id": "T-01", "feature": "F-01", "assertion": "Finalizer normalizes, validates, integrates with stopRecording, and preserves test stubs"},
    {"id": "T-02", "feature": "F-02", "assertion": "Creative protocol contains required phases, weights, claims, threshold, and repair cap"},
    {"id": "T-03", "feature": "F-03", "assertion": "Planner prompt contains state, artifacts, tool routing, transitions, failures, termination, and output schema"},
    {"id": "T-04", "feature": "F-04", "assertion": "Command routes are present and npm dry-run includes the agent"},
    {"id": "T-05", "feature": "F-05", "assertion": "Assessment exists and distinguishes current evidence, inference, blocker, and next slice"}
  ],
  "adrs": [
    {"id": "ADR-01", "decision": "Keep campaign orchestration in the shipped host-agent layer", "features": ["F-02", "F-03", "F-04"]}
  ]
}
```

## Architecture note and ADR-01

**Design intent.** Establish a creative-orchestration contract above the existing capture/render engine without changing the engine's public contract.

**Boundary.** The agent owns marketing reasoning and campaign artifacts; existing Spectra capture and demo operations remain the source of truth for capture, rendering, session, and library behavior.

**Alternatives.** A new typed daemon campaign API would give stronger runtime validation but would expand the public contract before the campaign state has been exercised. A native-first workflow would improve direct-app UX but is blocked and would duplicate agent logic prematurely.

**Decision.** Keep state in documented artifacts and prompt contracts now. Revisit typed persistence only after representative campaigns expose stable data requirements.

**Falsifier.** If two representative campaigns require recovery across host sessions, concurrent editors, or machine-enforced transitions that cannot be expressed safely in the artifact contract, ADR-01 is invalidated and a typed runtime contract becomes justified.

**Rollback.** Remove the added command/reference/agent changes without migrating user data; existing capture tools remain unchanged.

## Path A vs Path B

| Chunk | Path A: current architecture | Path B: pay-it-forward boundary | Decision |
|---|---|---|---|
| Creative loop | Markdown/JSON campaign artifacts interpreted by the host agent | New daemon campaign types and public operations | A; no named current capability requires a public runtime contract, and Path B would create speculative surface area |
| Finalization | Port the existing tested internal helper | Generalize a codec/finalizer plugin interface | A; the only required capability is compatible MP4 output |

## Six-Commit Table

`permission_tier: T3` — the marketing planner may write reversible campaign artifacts and produce local capture files through existing Spectra operations. It may not publish externally, spend money, delete user data, deploy, or alter permissions.

`parallel_skipped_reason: user did not authorize subagent delegation; C2-C6 also form a short dependency chain whose shared package and documentation surfaces are safer to validate serially.`

| # | Commit subject | Files owned | Depends on | dispatch_tier and reason |
|---|---|---|---|---|
| C1 | `docs(plans): specify marketing content quality loop` | `.build-loop/*`, `docs/plans/*` | — | `sonnet`: bounded synthesis across current evidence and research |
| C2 | `fix(media): finalize recordings for broad playback` | `src/media/finalize-recording.ts`, `src/daemon/core-impl.ts`, focused tests | C1 | `script`: port a known isolated commit and resolve only current-code context |
| C3 | `feat(marketing): define the creative quality protocol` | `skills/product-marketing/**` | C1 | `sonnet`: judgment-heavy workflow and rubric wording |
| C4 | `feat(marketing): ship deterministic planner and command` | `agents/marketing-planner.md`, `commands/**`, `package.json` | C3 | `sonnet`: agent transition and tool-routing contract |
| C5 | `test(marketing): lock shipped agent contract` | `tests/plugin/**` or nearest existing plugin-test location | C3, C4 | `haiku`: enumerable structural assertions |
| C6 | `docs(marketing): record quality and native assessment` | `docs/research/**`, `README.md`, research index if used | C2-C5 | `haiku`: evidence-backed synthesis with no new design decision |

## Capability Gap Map

| Capability/Workflow | Current source of truth | Target behavior | Gap | Build action | Owned files/contracts | Validation |
|---|---|---|---|---|---|---|
| Recording integrity | `src/daemon/core-impl.ts`; unique commit `aefb40d` | Stop returns a validated compatible MP4 | Main registers probed raw output without normalization | Port finalizer and integration | `src/media/finalize-recording.ts`, `src/daemon/core-impl.ts`, tests | focused media/daemon tests plus full suite |
| Creative strategy | `skills/product-marketing/SKILL.md` | Brief → three concepts → weighted selection | Current workflow selects one spine without comparison | Define the creative-loop protocol and route the current skill to it | `skills/product-marketing/**` | structural contract test and prompt read |
| Agent execution | `agents/marketing-planner.md` | Explicit state, artifacts, failures, repairs, stop | Current prompt is linear and underspecified | Add missing production-agent contract sections in place | `agents/marketing-planner.md` | prompt score ≥22/25 and contract test |
| Discoverability/distribution | `commands/spectra.md`, `package.json` | Marketing command routable and agent packaged | Missing route/command; `agents/` omitted | Add command, update router and package files | `commands/**`, `package.json` | npm pack dry-run and contract test |
| Native marketing direction | `macos/Spectra/Views/MenuBarPopover.swift`, `SpectraViewModel.swift` | Future brief/review surface consumes the same artifact contract | Native app only captures/walks and is Rally-blocked | Document next slice only | assessment doc | Rally evidence plus doc review |

## Single-Shot Build Guardrails

| Guardrail | Prevents | Evidence/test |
|---|---|---|
| Do not change public daemon or host-operation contracts | Speculative API expansion | `modifies_api: false`; contract snapshot remains unchanged |
| Keep claims evidence-linked and reject unsupported claims | Persuasive but untrustworthy content | Claim-status enum and blocking audit test |
| Keep exactly one audience, promise, proof sequence, and CTA per campaign | Feature-list videos and muddled conversion intent | Creative protocol and planner contract test |
| Port only commit `aefb40d`, not its stale branch history | Reintroducing obsolete code | `git cherry -v main fix/recording-finalize-yuv420p` and focused diff review |
| Preserve native files while Rally blocks them | Collision with active M1 privacy work | `rally check before-write --tool codex --path macos/Spectra --strict --json` |
| Re-run real validation after the last mutation | Narrative success without current evidence | build, full test, pack dry-run, acceptance-probe rerun |

## Read-Before-Edit Map

| Chunk/Work item | Read first | Why it matters | Edit after |
|---|---|---|---|
| C2 recording fix | `git show aefb40d`; `src/daemon/core-impl.ts`; current recording tests | Preserve the current stop lifecycle and stub behavior | media helper, core implementation, focused tests |
| C3 creative protocol | both supplied research notes; `skills/product-marketing/SKILL.md`; existing references | Extend the existing skill instead of duplicating it | product-marketing skill/reference files |
| C4 agent/command | plugin agent/command development guidance; current agent/router/package manifest | Ship a valid, discoverable, least-surprise agent surface | agent, command, package files |
| C5 contract tests | `vitest.config.ts`; nearest markdown/package structural tests | Use existing test conventions | nearest plugin test directory |
| C6 assessment | current native view/view-model; branch graph; rendering code; verified official sources | Separate measured current truth from roadmap inference | research report and README |

## Approach Lenses

| Lens | Result |
|---|---|
| Clean-sheet | A campaign runtime with typed persisted state and a dedicated native experience would maximize enforcement, but expands public boundaries before the workflow has real usage evidence. |
| Current constraints | Existing host agents, skills, commands, and capture/render operations can express the complete creative loop without a runtime contract change. |
| Selected | Extend the shipped host-agent layer now, validate through campaign artifacts and contract tests, and keep typed runtime/native work behind ADR-01's falsifier. |

## Depends-on (reads-from)

| Dependency / data path | Status | Evidence |
|---|---|---|
| Single-window recording stop lifecycle in `src/daemon/core-impl.ts` | verified | Read at current `main`; registers probed output after stop |
| Unique branch commit `aefb40d` | verified | `git cherry -v main fix/recording-finalize-yuv420p` marks it unique |
| Product-marketing skill and references | verified | Current skill and references read before planning |
| Demo script/render operations | verified | Current script schema and demo operation paths inspected |
| Native menu-bar capture/walkthrough state | verified | Current view and view model inspected read-only |
| Rally native write decision | verified | Strict before-write check rejects the native directory while the M1 blocker is active |

## Plan verification record

- `check_checklist.py`: clean, 22/22 answered, no structural warnings.
- `plan_verify.py`: clean, zero blockers or warnings.
- Acceptance-probe classifier: five criteria verifiable.
- Adversarial subagent critic: not dispatched because this session explicitly prohibits subagent delegation unless the user asks for it. Inline review confirmed scope, traceability, rollback, dependencies, falsifier, and final gates; the deterministic checks remain authoritative for this run.

## F-Criteria (functional)

| ID | Criterion | Pass condition | Grader |
|---|---|---|---|
| F-01 | Recording finalization | Focused tests prove normalize, validate, failure, and stub paths; stopRecording registers finalized path | Vitest |
| F-02 | Creative loop | Protocol contains brief, three concepts, fixed weights summing to 100, evidence states, storyboard, 75-point audit, ≥65 threshold, and ≤2 repairs | Structural test + review |
| F-03 | Planner determinism | Agent contains states, artifact schema, tools, transitions, failures, termination, and output contract | Structural test + Prompt Builder score |
| F-04 | Distribution | `/spectra:marketing` exists, router exposes it, and package dry-run contains `agents/marketing-planner.md` | Vitest + `npm pack --dry-run --json` |
| F-05 | Assessment | Report covers current quality, native gap/blocker, branch disposition, research decisions, and next slice | Evidence review |

## Q-Criteria (quality)

| Criterion | Pass condition | Grader |
|---|---|---|
| TypeScript/build | `npm run build` exits 0 | command |
| Regression | `npm test` exits 0 after final mutation | command |
| Package integrity | dry-run tarball contains commands, skills, and agent | command/JSON inspection |
| Prompt quality | Prompt Builder score is at least 22/25 with no dimension below 3 | rubric review |
| Scope | No `macos/Spectra` or unrelated canonical-worktree change | `git diff --name-only` + Rally |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Markdown-only workflow becomes vague | Medium | Define state/artifact schemas, transitions, tests, and stop conditions |
| Fixed rubric implies false precision | Medium | Present it as a repeatable selection/audit heuristic, not predicted performance |
| Stale finalizer conflicts with current core | Medium | Port one commit, inspect conflicts, run focused and full tests |
| Agent exists locally but does not ship | High before fix | Add `agents/` to package files and assert tarball contents |
| Native roadmap drifts from host workflow | Medium | Document one shared artifact contract; defer UI until blocker clears |

## UI Input/Output Contract

| Surface | Inputs | Outputs | Data taxonomy | Operation | Component mapping | States | Modality | Validation/security | Traceability |
|---|---|---|---|---|---|---|---|---|---|
| No changed UI surface; native app is assessment-only | No new user input | No new system output | No changed UI data | No UI operation | No component change | Existing states unchanged | Existing native modality unchanged | Rally blocks native writes | Native follow-on is documented in F-05/T-05 only |

```yaml
synthesis_dimensions:
  placement: "no changed UI placement; native assessment remains in the research report"
  cta_tier: "no changed UI call to action"
  copy_tone: "no changed user-facing UI copy"
  visual_weight: "no changed UI visual weight"
  empty_state: "no changed UI empty state"
```

## Out of Scope

- Native SwiftUI changes while the M1 privacy-attribution blocker is active.
- New external services, packages, public API types, or campaign persistence.
- Direct merge of stale branches or mutation of unrelated canonical-checkout dirt.
