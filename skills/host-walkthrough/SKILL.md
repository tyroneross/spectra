---
name: host-walkthrough
description: Use when the user asks to walk me through a UI, demo this flow, show me how a feature works, capture a walkthrough, or navigate a web/macOS app with Spectra.
version: 0.1.0
user-invocable: false
---

# Host-Routed Walkthrough

Use this skill when a host agent is driving Spectra. The host LLM plans from
snapshots. Spectra executes actions and captures media.

This is the primary path for Claude Code, Codex, and any future host that can
call Spectra MCP tools. It does not require a vendor API key inside Spectra.

## Success Policy

Match the standalone app semantics documented in
`references/success-policy.md` and implemented by
`WalkthroughSuccessPolicy.evaluate`:

- Success requires a user-provided predicate match or an explicit `done`
  rationale grounded in the latest snapshot.
- Executed actions alone do not prove success.
- Step failure retries are limited to one re-snapshot plus replan attempt.

## Procedure

1. Resolve the target.
   - URL: call `spectra_connect` with the URL.
   - macOS app: ensure the app is running, then call `spectra_connect` with the app name.
   - Existing session: use the supplied session ID.
2. Call `spectra_snapshot`.
3. Decide the next action from the snapshot.
   - Prefer `spectra_step` for clear natural-language actions.
   - Use `spectra_act` only when you need to target a specific element ID.
4. Re-snapshot after every action.
5. Stop only when the success policy passes or the flow is blocked.
6. Call `spectra_capture` at user-meaningful states.
7. Close with a concise report: session ID, actions taken, capture paths, and final status.

## Web Example

User: "Walk through the export flow on http://localhost:4300."

Host-agent flow:

1. `spectra_connect({ "target": "http://localhost:4300" })`
2. `spectra_snapshot({ "sessionId": "<id>" })`
3. Plan from visible navigation.
4. `spectra_step({ "sessionId": "<id>", "intent": "open Export" })`
5. `spectra_snapshot({ "sessionId": "<id>" })`
6. If the Export heading is visible, mark done and capture:
   `spectra_capture({ "sessionId": "<id>", "type": "screenshot", "label": "export-flow" })`

## macOS Example

User: "Walk through opening Settings in Spectra."

Host-agent flow:

1. Confirm Spectra is running.
2. `spectra_connect({ "target": "Spectra" })`
3. `spectra_snapshot({ "sessionId": "<id>" })`
4. Plan from the visible controls.
5. `spectra_step({ "sessionId": "<id>", "intent": "open settings" })`
6. `spectra_snapshot({ "sessionId": "<id>" })`
7. If the Settings view is visible, capture and report done.

## Reporting

Use plain language:

- "Opened Export and captured the final screen."
- "Stopped after retry because the Settings control was not visible."

Avoid internal transport words in user-facing output.
