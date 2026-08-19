# Spectra native campaign UI: audit and implementation handoff

Date: 2026-07-10  
Status: design target ready for review; native implementation blocked  
Visual register: Aurora Glass  
Structural system: Calm Precision  

## Bottom line

Spectra's current macOS UI has a coherent visual foundation, but its information architecture cannot carry the new marketing-content loop. The whole app is a 380-point menu-bar popover that already holds setup, capture, walkthrough, history, preview, errors, settings, and quit. Adding campaign strategy, concepts, evidence, storyboard, production, and audit there would make the product harder to use.

The target is a two-surface experience:

1. A 300–320 point menu-bar controller for glanceable status, start/stop, resume, and `Open Studio`.
2. A resizable Campaign Studio window for the six-stage creative workflow.

"Cool" comes from the media, crisp hierarchy, responsive state changes, and one restrained Aurora accent. It does not come from additional glass layers, animated gradients, or ornamental dashboards.

No file under `macos/Spectra` was changed. Rally blocker `fact_6edf_18bf9c15e8951b50` remains active because `dev.spectra.app` privacy-pane attribution is not proven.

## Review targets

- Scratch structure: `mockups/00-scratch-spectra-campaign-window.html`
- Aurora Glass proposal: `mockups/01-spectra-campaign-window-aurora-glass.html`

Both targets are **unrated**. The scratch becomes a `wireframe-target` and the Aurora version becomes a `visual-target` only after user approval. Production SwiftUI must not be implemented from an unrated mockup.

## Evidence from the current app

### Source evidence

| Priority | Finding | Evidence | Required correction |
|---|---|---|---|
| P0 | The app has one `MenuBarExtra` scene and no dedicated window, toolbar, navigation model, or command surface. | `macos/Spectra/SpectraApp.swift`; `Views/MenuBarPopover.swift` | Keep the popover compact; add a Campaign Studio `WindowGroup` after the native blocker clears. |
| P0 | Permission recovery is misleading. `Skip for now` persists across launches, despite copy that promises a temporary skip; success UI is immediately dismissed and cannot be read. | `Views/AccessibilityPanel.swift` around the permission check, dismissal flag, and `shouldShow()` paths | Make skip session-scoped or explicitly persistent; keep success visible long enough to acknowledge; add tests. |
| P0 | Permission copy says users will find “Spectra” in System Settings, but Rally evidence currently shows helper/bare binary entries. | `Views/Copy.swift`; Rally blocker `fact_6edf_18bf9c15e8951b50` | Fix attribution first, then write exact copy based on live evidence. |
| P0 | Native state stops at repo + walkthrough + session + recording. There is no campaign, audience, placement, evidence, storyboard, audit, repair, or readiness model. | `ViewModels/SpectraViewModel.swift` | Consume the shipped campaign artifact contract; do not create a second native-only marketing loop. |
| P1 | `Open in Finder` is disabled after a successful stop even though `revealSession()` can fall back to the latest session. | `SpectraViewModel.canSave`, `stopSession()`, `revealSession()`; `MenuBarPopover.primaryActions` | Enable reveal from the most recent saved session or recording, independent of an active session. |
| P1 | Start/install/stop lack per-action in-flight states and can be submitted repeatedly. `RecoveryError.actionLabel` is not rendered. | `ViewModels/SpectraViewModel.swift`; `Views/LoadableState.swift`; `MenuBarPopover.errorToast` | Use named async states, prevent duplicate work, and render the real recovery action. |
| P1 | The current UI makes an Anthropic key appear required for the product's planning path. | `Views/Copy.swift`; `SpectraViewModel.canRunWalkthrough` | Make host-agent orchestration primary and provider-neutral. Keep Anthropic as an optional standalone fallback. |
| P1 | Keyboard/hover treatment is incomplete. `⌘S` starts capture, conflicting with the standard Save convention; several icon-only actions have no explicit hit-area/hover treatment. | `Views/MenuBarPopover.swift`; `Views/ActionButtonStyle.swift` | Adopt a command model, visible focus, 24-point minimum targets, hover treatment, and platform-consistent shortcuts. |
| P2 | Aurora tokens exist, but semantic use is inconsistent: hard-coded status colors bypass tokens; error UI uses warning treatment; defined focus/hover tokens are unused. | `Views/DesignTokens.swift`; `Views/MenuBarPopover.swift` | Route color through semantic tokens and complete the full state recipes. |
| P2 | `RecentsStore` uses the app bundle identifier as a `UserDefaults` suite and logs a runtime warning. | `Storage/Recents.swift` | Use `.standard` or a real app-group suite and cover it with a configuration test. |

### Rendered evidence

The current DEBUG target built successfully to `/tmp/spectra-ui-audit-derived`. The exact shipped views rendered to `/tmp/spectra-ui-audit/`:

- populated popover: 380×707 points;
- first-run popover: 380×648 points;
- light and dark settings plus permission panels.

The render confirms excessive vertical density and weak prioritization in the popover. It also finds a verifier defect: `ImageRenderer` replaces native `TextEditor` and secure-field controls with yellow unavailable tiles. The fixture's `onAppear` also refreshes real filesystem state and mutates the supposedly deterministic preview. This harness is useful for layout evidence but does not prove those native controls render correctly.

A live accessibility scan could not run because the Mac was locked. After unlock, runtime validation must use the actual built app and record AX bounds, labels, focus order, and screenshots.

## Design decisions

### D1 — Preserve Aurora Glass

Aurora Glass remains the right register: Spectra is a refined utility used beside the primary workspace. Preserve native materials, static ambient light, adaptive surfaces, indigo `#818cf8`, and restrained semantic green/amber/rose.

Do not add:

- animated ambient gradients;
- neon borders around every panel;
- stats-card dashboards;
- filled status badges;
- custom traffic lights;
- decorative motion or bounce;
- multiple competing accent colors.

The active guidance pointer was corrected to the live source at `~/dev/git-folder/UI Guidance/references/modes/style-mode-aurora-glass.md`. The register itself did not change.

### D2 — Separate controller from workbench

The menu-bar popover is for operations that can be understood and acted on in seconds. Campaign planning is an editor/workbench task and gets a dedicated window.

```text
Menu-bar popover, 300–320 pt
┌─────────────────────────────┐
│ Spectra               Ready │
│ July product launch         │
│ Strategy · 4 inputs ready   │
│                             │
│ [ Open Studio ]             │
│                             │
│ Latest capture       Review │
│ Settings       Quit Spectra │
└─────────────────────────────┘

Campaign Studio, default 1100×720 pt
┌──────────────┬────────────────────────────────┬──────────────────┐
│ Stage rail   │ Primary campaign canvas        │ Context panel    │
│ 200–220 pt   │ ≥60% of content area           │ 280–320 pt       │
│              │                                │ collapsible      │
│ Strategy     │ One L1 promise                 │ readiness        │
│ Concepts     │ Current-stage content          │ evidence         │
│ Proof        │ One contextual primary action  │ selected detail  │
│ Storyboard   │                                │ audit blockers   │
│ Produce      │                                │                  │
│ Quality      │                                │                  │
└──────────────┴────────────────────────────────┴──────────────────┘
```

The context panel is visible for readiness, evidence, scene detail, and audit work; it can collapse when the canvas or video needs width. If persistent multi-pane resizing is implemented, use native `NSSplitView` behavior rather than a custom drag layout.

### D3 — Six user-facing stages over ten agent states

| UI stage | Agent states | User decision |
|---|---|---|
| Strategy | `DEFINE`, `DIAGNOSE` | Is the audience, viewer question, placement, action, and success measure specific enough? |
| Concepts | `CONCEPT`, `SELECT` | Which of the three directions best balances audience, proof, differentiation, conversion, and feasibility? |
| Proof | `EVIDENCE` | Is every material claim demonstrated or supported? |
| Storyboard | `STORYBOARD` | Does every beat link product action, claim, and proof shot? |
| Produce | `PRODUCE`, `ENHANCE` | Is the footage complete, legible, paced, and technically valid? |
| Quality | `AUDIT`, `REPAIR` | Is the campaign at least 65/75 with zero blockers, or what single repair matters next? |

Six stages keep proof and story approval distinct. A five-stage alternative was rejected because merging those steps hides the point where unsupported claims must block production.

### D4 — One primary action per stage

| Stage | Primary action | Secondary actions |
|---|---|---|
| Strategy | `Generate Concepts` | Save Draft |
| Concepts | `Select Direction` | Compare Evidence, Edit Strategy |
| Proof | `Approve Proof` | Add Source, Reframe Claim |
| Storyboard | `Approve Storyboard` | Edit Beat, Preview Flow |
| Produce | `Capture Scene` or `Render Cut` | Pause, Cancel, Reveal Files |
| Quality | `Repair Next` or `Export Video` | View Audit, Reveal Campaign |

Only enable an action when a real implementation exists. Until a `CampaignPlannerPort` is wired, `Generate Concepts` must be disabled with an explanation or omitted. The HTML mockup labels its controls as prototype-only for this reason.

## Surface contract

### Menu-bar controller

Show only:

- service/recording state from one shared state source;
- current campaign name and current human-readable stage;
- one contextual primary action: `New Campaign`, `Open Studio`, `Resume Campaign`, or `Stop Capture`;
- latest capture thumbnail/name with `Review`;
- subordinate Settings and Quit.

Move out of the popover:

- repository history;
- multi-line walkthrough/planning input;
- session history;
- full recording list;
- video player;
- campaign forms and audit detail.

### Campaign Studio

- Standard macOS window chrome and traffic lights.
- Native sidebar or split-view material, 200–220 points.
- One campaign promise/title as the L1 anchor.
- Main content retains at least 60% of the content region.
- Context panel collapses and remembers its width.
- Group related rows with one border and internal dividers.
- Three-line hierarchy: title, description, metadata.
- Status is icon + text color, not filled background badges.
- Media preview becomes the visual hero in Storyboard, Produce, and Quality.
- Tooltips on every icon-only action; minimum 24×24 point desktop hit area.

## Data and action contract

The native app reads and writes the same campaign directory as the host agent:

```text
.spectra/campaigns/<slug>/
  manifest.json
  creative-brief.md
  diagnosis.md
  concepts.md
  claim-ledger.md
  script.md
  storyboard.md
  production-plan.md
  audit.md
```

Initial native models:

```text
CampaignManifest
  slug, title, projectPath, agentState, uiStage
  repairCount, readinessScore, blockers
  selectedConceptId, updatedAt, artifactPaths

CampaignSummary
  title, stage, desiredAction, placement
  nextAction, blockedReason, latestAsset

CampaignPlannerPort
  generateConcepts, selectConcept, approveProof
  approveStoryboard, startProduction, runAudit, repairNext
```

`CampaignPlannerPort` is provider-neutral. Preferred routing is the shipped host agent. The existing Anthropic planner may conform as an optional standalone fallback, but UI copy must identify it as such.

## State contract

| State | Required UI |
|---|---|
| First use | Explain the value of campaigns; `Create Campaign`; no blank pane. |
| Strategy incomplete | Name the one missing required field inline; preserve entered values. |
| Generating concepts | Named step/progress after three seconds; Cancel where safe; prevent duplicate submission. |
| Claim blocked | Unsupported claim first, what is missing, and `Add Source` or `Reframe Claim`. |
| Producing | Current scene, completed/total count, elapsed time, Pause/Cancel, last valid artifact. |
| Finalizing | “Preparing playable video”; no false completed state. |
| Audit failed | Decision-first heading such as “Needs 2 repairs”; blockers before the 15 dimensions. |
| Ready | “Ready to test”; readiness score; Export and Reveal. |
| Error | What happened → why → exact fix; real Retry/Open Settings action. |
| Empty search/filter | Explain why empty; show total count and `Clear Filters`. |

All animated state changes respect Reduce Motion. Use short fades/press feedback only; no looping motion.

## Keyboard contract

| Shortcut | Action |
|---|---|
| `⌘N` | New Campaign |
| `⌘O` | Open Campaign |
| `⌘↩` | Run or approve the contextual next step |
| Space | Preview selected media when focus is not in a text field |
| `⌘,` | Settings |
| `⌘W` | Close window |
| Escape | Cancel/dismiss the current sheet or safe operation |

Do not use `⌘S` for Start Capture. If Save exists, retain the platform convention.

## Implementation sequence after the blocker clears

### U0 — Repair the existing trust and recovery defects

- Resolve app/helper privacy attribution and recapture both System Settings panes.
- Fix permission skip persistence and unreachable success UI.
- Make reveal work after stop.
- Add real async action states and recovery actions.
- Correct `UserDefaults` configuration.

### U1 — Add read-only campaign models

- Decode `manifest.json` and locate the declared Markdown artifacts.
- Map ten agent states to six stable UI stages.
- Render campaign lists grouped by In Progress, Blocked, and Ready.
- Add file-observation/reload behavior and decoding/error tests.

### U2 — Introduce the two-surface shell

- Slim the popover to status + contextual action + latest asset.
- Add the Campaign Studio `WindowGroup`, toolbar, sidebar, and collapsible context panel.
- Add app commands and focus/hover recipes.
- Keep all orchestration actions disabled until a real port is wired.

### U3 — Strategy, Concepts, Proof, Storyboard

- Wire real artifact editing and validation.
- Add exactly three concept routes in one grouped comparison surface.
- Put unsupported claims first and block approval.
- Link storyboard beats to claim and source identifiers.

### U4 — Produce and Quality

- Use existing capture/render/library operations.
- Show current scene and named progress.
- Make the video the visual anchor.
- Present blockers before the detailed audit and enforce the two-repair cap.

## Validation gates

The native implementation is complete only when all apply:

- `xcodebuild ... build` and full native tests pass.
- Real-window screenshots cover light/dark, first-use, active, blocked, producing, and ready states.
- `scan_macos` or equivalent live AX evidence records window structure, labels, bounds, and actions.
- Keyboard-only completion works from campaign creation through concept generation.
- VoiceOver reads logical order and every icon-only action has a label and tooltip.
- Increase Contrast and Reduce Motion preserve meaning.
- Window resize is stable from minimum to large width; context panel collapses without hiding the primary action.
- Permission skip/recovery, start → stop → reveal, campaign restoration, unsupported-claim blocking, provider-neutral routing, and repair cap have UI tests.
- No enabled control lacks a real handler.
- Screenshot verification uses a real window or a harness that faithfully renders native text controls and freezes fixture dependencies.

## Current gate and next action

The safe next action is user review of the two mockups. After approval and resolution of Rally blocker `fact_6edf_18bf9c15e8951b50`, implement U0 before adding the Campaign Studio shell. This ordering avoids layering an attractive new workflow on top of broken permission and recovery behavior.
