# Handoff — Spectra Marketing Content Quality Loop

## Mission

Implement the host-agent creative loop above Spectra's current capture/render engine, port the single unique recording finalizer, and leave native UI untouched while Rally's privacy-attribution blocker remains active.

## Ground truth

- Worktree: `/Users/tyroneross/dev/git-folder/spectra-marketing-loop`
- Branch: `codex/marketing-content-loop`
- Base: `f3129c8` (`main` and `origin/main` at assessment time)
- Unique port source: `aefb40d` on `fix/recording-finalize-yuv420p`
- ADR-01: keep campaign orchestration in the host-agent layer; do not add daemon/MCP operations.
- Native stop: `rally check before-write --tool codex --path macos/Spectra --strict --json` is authoritative.

## Implementation pointers

- When implementing F-01, read commit `aefb40d`, current `src/daemon/core-impl.ts`, and the focused recording tests; satisfy T-01 without changing public contracts.
- When implementing F-02, read both supplied research notes and the existing product-marketing skill; read ADR-01 and satisfy T-02.
- When implementing F-03, read the plugin agent-development and Prompt Builder agent/structured-output guidance; read ADR-01 and satisfy T-03.
- When implementing F-04, read current command frontmatter and `package.json`; satisfy T-04 with a real package dry-run.
- When implementing F-05, read the native view/view-model, branch graph, render pipeline, and Rally blocker evidence; satisfy T-05 without editing native files.

## Integration contract

- The agent owns audience reasoning, creative artifacts, concept selection, evidence checking, audit, and repair decisions.
- Existing Spectra tools own connection, navigation, capture, rendering, sessions, and library persistence.
- Campaign artifacts live under `.spectra/campaigns/<slug>/` when the host can write; otherwise the agent returns the same sections inline.
- Unsupported claims never progress to production.

## Required verification

1. Acceptance probes no longer emit their baseline signals.
2. Focused recording and marketing-contract tests pass.
3. `npm run build` passes.
4. `npm test` passes after the final workspace mutation.
5. `npm pack --dry-run --json` contains the marketing agent, command, and skill.
6. Final diff excludes `macos/Spectra` and unrelated canonical-checkout dirt.
