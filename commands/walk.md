---
name: walk
description: Walk through a UI flow with the host LLM planning and Spectra executing
arguments:
  - name: description
    description: Natural language description of the flow
    required: true
---

Run a host-routed Spectra walkthrough.

The host LLM is the planner. Spectra is the executor and media-capture layer.
Do not call vendor SDKs or require model API keys for this command.

## Inputs

Interpret `$ARGUMENTS` as the walkthrough goal. It may include:
- Target: URL, app name, or active session ID.
- Goal: what state the user wants shown.
- Optional success predicate: a route, visible text, or final state to confirm.
- Optional capture request: screenshots at each important state, video, or final-only capture.

If the target is missing and there is no obvious active session, ask for the target once.

## Loop

1. Connect or reuse a session.
   - If the user gave a URL, app name, or simulator target, call `spectra_connect`.
   - If the user gave a session ID, continue with that session.
2. Read the current screen with `spectra_snapshot`.
3. Plan the next action from the snapshot.
   - Choose one concrete action that advances the goal.
   - Prefer `spectra_step` for obvious intent-level actions.
   - Use `spectra_act` only when the snapshot shows the exact element ID and intent resolution would be ambiguous.
4. Execute the action.
5. Re-read the screen with `spectra_snapshot`.
6. Decide whether to stop:
   - Stop with success when the snapshot matches the user-provided success predicate.
   - Stop with success when you can give an explicit `done` rationale from the current screen.
   - Continue when another action is needed and the step budget is not exhausted.
7. Capture media with `spectra_capture`.
   - Capture after every user-meaningful state unless the user requested final-only capture.
   - Use labels that describe the state, not the implementation.

## Retry And Failure Policy

- On an action failure, re-snapshot and replan once before declaring failure.
- If the second attempt fails, stop and report the visible state plus the attempted action.
- Never mark a walkthrough successful just because actions ran. Success requires either a matching predicate or an explicit `done` rationale grounded in the latest snapshot.
- Default step budget: 10 turns unless the user requested a shorter flow.

## Output

Keep the user-facing report short:
- Session ID.
- Steps completed.
- Capture paths.
- Final status: `done`, `partial`, or `blocked`.

Use plain product language. Avoid internal transport or accessibility-tree terminology in user-facing text unless the user explicitly asks for internals.
