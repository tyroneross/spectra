---
name: walk
description: Walk through a UI flow with natural language steps
arguments:
  - name: description
    description: Natural language description of the flow
    required: true
---

Execute a multi-step UI flow described in natural language.

Break the description into individual steps. For each step:
1. Use `spectra_step` with the intent
2. If candidates are returned (not auto-executed), pick the best element and use `spectra_act`
3. Verify the action succeeded by checking the post-action snapshot
4. Capture a screenshot with `spectra_capture`

Present progress after each step with the AX tree snapshot.
