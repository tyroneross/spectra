---
name: spectra
description: Route a Spectra request to capture, connection, library, marketing, recording, sessions, or walkthrough workflows
argument-hint: "[what you want to do]"
---

# /spectra — router

Route the raw request to the most specific existing subcommand or Spectra skill.

**Raw user input:** `$ARGUMENTS`

## Routes

| Intent | Route |
|---|---|
| screenshot, capture current state, short video of active session | `/spectra:capture` |
| connect/open a URL, app, or simulator target | `/spectra:connect` |
| find, tag, preserve, export, or migrate captures | `/spectra:library` |
| plan, produce, improve, or audit marketing content/video | `/spectra:marketing` |
| record two macOS windows as a composite | `/spectra:record` |
| list, inspect, or close sessions | `/spectra:sessions` |
| navigate and capture a UI flow | `/spectra:walk` |

If the request names a more specific Spectra skill, load it. If a workflow spans routes, use the smallest ordered sequence that completes it; do not invent a subcommand.

When `$ARGUMENTS` is empty, list the seven routes with one-line descriptions. If no route fits, state what is unsupported and show the list.

Prefer direct execution when the target and intent are clear. Ask only for missing information that prevents safe routing or changes the requested outcome.
