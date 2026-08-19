---
name: marketing
description: Plan, produce, improve, or audit audience-specific product marketing content with Spectra
argument-hint: "<product, audience, placement, desired action, or asset to audit>"
---

# /spectra:marketing

Dispatch the `marketing-planner` agent with the user's raw input:

`$ARGUMENTS`

The agent must use the product-marketing creative loop: define the brief, diagnose the audience problem, compare proof-led/problem-led/transformation-led concepts, select with fixed weights, evidence-check claims, storyboard, optionally produce, then audit and repair.

## Intent routing

- “Plan,” “storyboard,” or “what should I make” → `mode=plan`; stop at `PLAN_READY`.
- “Create,” “record,” “produce,” or “make the video” → `mode=produce`; use current Spectra operations and return real paths.
- “Improve,” “enhance,” “audit,” “why is this weak,” or an existing asset path → `mode=audit-and-repair`; score the current asset before changing it.

Infer product context from the repo and inspect supplied assets first. Ask only when a missing decision changes the concept or acceptance gate. Never fabricate product proof or production results.

Return the agent's answer-first summary and machine-readable receipt.
