<!-- SPDX-FileCopyrightText: 2025-2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com> | SPDX-License-Identifier: Apache-2.0 -->

# Coordination — Host-routed plugin shape (2026-05-24)

**Date:** 2026-05-24
**Session:** codex (implementation owner — all 5 pieces); claude_code (verifier)
**Status:** active — archived per closeout when all pieces land
**Predecessor:** `.build-loop/coordination/ui-best-practices-2026-05-24-2026-05-24.md` (now closed)

## Scope

Make Spectra **host-routed first**: when Claude Code, Codex, or any future coding agent loads the Spectra plugin/MCP server, the host's LLM is the planner — it reads AX snapshots, decides actions, calls Spectra's MCP tools (`spectra_step`, `spectra_act`, `spectra_capture`, etc.) in a loop. The previous Anthropic-direct path (`runner.ts` calling `callAnthropic`, `WalkthroughPlanner.swift` calling `AnthropicClient`) is downgraded to a documented fallback for the standalone `Spectra.app` use-case where no host agent is present.

**Pieces:**

- **H1-walk-skill-tighten** — Rewrite `commands/walk.md` from 4 terse bullets into a proper host-LLM driver: connect → snapshot → plan (host LLM reasons over AX tree) → act → re-snapshot → predicate-or-done → loop, with retry + success policy + jargon-free output baked into instructions. Same shape as P3's `WalkthroughSuccessPolicy.evaluate` semantics, but expressed as instructions a host LLM follows. **Owner: codex.**
- **H2-walkthrough-skill** — New skill `skills/host-walkthrough/SKILL.md`: explicit recipe a host agent invokes when the user says "walk through X". Covers web and macOS targets. Cites the predicate / `done` success policy from `WalkthroughSuccessPolicy` (Swift) so behavior is consistent across the standalone and host-routed paths. **Owner: codex.**
- **H3-retire-doe-bench** — Move `.build-loop/experiments/walkthrough-bench/` → `archive/walkthrough-bench-anthropic-direct/` with a `README.md` explaining the shape mismatch (measures direct Anthropic, not host-routed). Keep the validity fixes in `src/` and `macos/` (URL field, split latency, success policy, snapshot-mode toggle) — those are host-routed-compatible. Remove `bench:walkthrough` + `bench:walkthrough:analyze` from `package.json` scripts. **Owner: codex.**
- **H4-document-standalone** — Add a top-of-file comment block to `macos/Spectra/LLM/WalkthroughPlanner.swift` and `macos/Spectra/LLM/AnthropicClient.swift` marking them as the standalone-app-only path. Add a "Routing: host vs standalone" section to the repo `README.md` explaining the two paths. **Owner: codex.**
- **H5-cross-agent-verify** — Author `tests/cross-agent/walkthrough.md` (LLM-readable instructions a host agent follows to run a known 3-step flow end-to-end through `spectra_walkthrough` + `spectra_capture`) and `scripts/verify_cross_agent.sh` (deterministic executor check: starts daemon, runs `spectra_walkthrough` with a scripted `steps[]`, asserts non-empty session + capture artifact). **Codex authors AND executes from inside Codex** — the cross-agent fitness proof is Codex running this skill end-to-end as the deliverable. **Owner: codex (authoring + execution).**

**Out of scope (this rally):**

- New deterministic-replay bench shape (defer until H5 proves host-routed path is solid).
- Any macOS Views or web-ui changes (P1 + P2 just landed; don't touch).
- New MCP tools (12 tools already exist; rewire calls, don't add).
- ANTHROPIC_API_KEY usage anywhere except the standalone-app fallback path.

## Operating Rule (binding — inherited from references/coordination-rules.md)

A piece does not advance past `verification-pending` until the peer verifier posts one of:

- `PASS` — acceptance criteria verified.
- `VARIANCE` that has been resolved.
- Explicit user override.

`VARIANCE` unresolved blocks the next piece. `BLOCKED` requires the producing peer to supply evidence first.

## Coordination Protocol (binding — inherited)

- All Rally Point writes go through `scripts/rally_point/post.py` `post()` helper.
- Cheap detection at every step boundary: `python3 ~/.claude/plugins/cache/rosslabs-ai-toolkit/build-loop/0.12.16/scripts/coordination_status.py --workdir . --session-id <id> --coordination-file .build-loop/coordination/host-routed-plugin-shape-2026-05-24.md --json`.
- Verifier feedback entry format:

  ```md
  ### YYYY-MM-DD HH:MM TZ — <verifier> <VERDICT>
  **Step:** <piece id>
  **Verdict:** PASS | VARIANCE | BLOCKED
  **Evidence:** <file:line or command result>
  **Impact:** <why this matters>
  **Requested action:** <fix / explain / user decision>
  ```

## MECE Ownership Packets per Piece

### H1-walk-skill-tighten

- **Owns** (codex):
  - `commands/walk.md`
- **Does not own**: `commands/connect.md`, `commands/capture.md`, `commands/sessions.md`, `commands/library.md`, `commands/spectra.md`, anything in `src/`, `macos/`, `web-ui/`, `.build-loop/` (except this coord file's feedback log), `skills/content-capture/`.
- **Interface contract**: `commands/walk.md` is a host-agent slash command — markdown with YAML frontmatter (`name`, `description`, `arguments`). Frontmatter shape unchanged. Body is host-LLM instructions only (no code, no API keys, no vendor SDK references). Must reference `spectra_connect`, `spectra_snapshot`, `spectra_step`, `spectra_act`, `spectra_capture` as the only execution surface. Must include success policy: "stop when host LLM emits an explicit `done` rationale OR a user-provided success predicate matches the snapshot."
- **Integration checkpoint**: claude_code verifies by reading `commands/walk.md` and confirming (a) no `ANTHROPIC_API_KEY` / `claude-` / `gpt-` strings, (b) instructions form a complete connect→snapshot→plan→act→re-snapshot→predicate-or-done loop, (c) retry guidance present, (d) jargon-free user-facing copy.

### H2-walkthrough-skill

- **Owns** (codex):
  - `skills/host-walkthrough/SKILL.md` (new)
  - `skills/host-walkthrough/references/success-policy.md` (new, optional)
- **Does not own**: existing `skills/content-capture/**`, `commands/**` (except per H1), source code.
- **Interface contract**: SKILL.md frontmatter has `name: host-walkthrough`, `description:` with trigger phrases ("walk me through", "demo this flow", "show me how"), `user-invocable: false` (host-agent invokes). Body: when-to-use + how-to-use + success-policy + worked example covering web and macOS targets. References `WalkthroughSuccessPolicy.evaluate` semantics (Swift) for behavioral parity citation.
- **Integration checkpoint**: claude_code verifies skill loads via host-agent description match, has both web + macOS worked examples, cites the success policy file or Swift symbol, no vendor SDK refs.

### H3-retire-doe-bench

- **Owns** (codex):
  - `.build-loop/experiments/walkthrough-bench/` → `git mv` to `archive/walkthrough-bench-anthropic-direct/`
  - New: `archive/walkthrough-bench-anthropic-direct/README.md` explaining shape mismatch
  - `package.json` — remove `bench:walkthrough` + `bench:walkthrough:analyze` scripts
  - `docs/HANDOFF.md` — update or remove the one-cell smoke section (the smoke targeted the retired bench)
  - `tests/experiments/walkthrough-runner.test.ts` — move with the archive OR delete with a brief note in the archive README; either way `npm test` stays green
- **Does not own**: `src/mcp/tools/snapshot.ts`, `src/cdp/driver.ts`, `.build-loop/experiments/lib/score.ts`, other tests under `tests/experiments/`, `macos/Spectra/LLM/**`. Validity fixes from P3 stay in place — they're host-routed-compatible.
- **Interface contract**: `npm test` stays green. `tsc --noEmit` clean. `package.json` no longer advertises the retired bench.
- **Integration checkpoint**: claude_code verifies `.build-loop/experiments/walkthrough-bench/` no longer exists, archive README is present and names the reason, `package.json` scripts no longer include the bench, `npm test` + `tsc --noEmit` still clean.

### H4-document-standalone

- **Owns** (codex):
  - Top-of-file comment in `macos/Spectra/LLM/WalkthroughPlanner.swift`
  - Top-of-file comment in `macos/Spectra/LLM/AnthropicClient.swift`
  - New section in `README.md`: "Routing: host-routed vs standalone" (or similar header)
- **Does not own**: function bodies in those Swift files (still working code for the fallback path; don't refactor).
- **Interface contract**: Comments are non-functional doc only — no behavior change. README section explains: (a) primary path = host coding agent calls MCP tools; (b) fallback = `Spectra.app` standalone, uses `WalkthroughPlanner` + `AnthropicClient`; (c) when each applies; (d) `ANTHROPIC_API_KEY` is only needed for the fallback.
- **Integration checkpoint**: claude_code verifies the two comment blocks exist, the README section exists, `xcodebuild test` stays 27/27 green (no behavior change).

### H5-cross-agent-verify

- **Owns** (codex):
  - `tests/cross-agent/walkthrough.md` (new — LLM-readable host-agent instructions)
  - `scripts/verify_cross_agent.sh` (new — deterministic check)
  - This coord file's verifier feedback log — append the Codex run-from-inside-Codex artifact (session log excerpt, capture path, exit code)
- **Does not own**: any production code.
- **Interface contract**:
  - `tests/cross-agent/walkthrough.md`: markdown that any host agent can follow to drive a 3-step flow (target: spectra's own `web-ui` running on `localhost:3000`, since it's a known-stable app under the user's control). Steps: connect, navigate to a route, capture screenshot. Outcomes: session ID + capture artifact path in `.spectra/sessions/<id>/`.
  - `scripts/verify_cross_agent.sh`: bash that starts the daemon, runs `spectra_walkthrough` programmatically with a scripted `steps: [{intent: "..."}, ...]`, asserts session opened + at least one capture in `.spectra/sessions/<id>/`, exits 0 on success. Cleans up daemon on exit.
  - **Codex executes the walkthrough.md instructions from inside Codex** as part of this piece's deliverable. Records what happened (success / variance / blocked) in the rally feedback log.
- **Integration checkpoint**: claude_code verifies both files exist, `scripts/verify_cross_agent.sh` exits 0 (run by claude_code as independent re-run), and the rally feedback log contains a Codex execution entry with concrete evidence.

## Step status (live)

| # | Piece | Owner | Status | Pending verifier check |
|---|---|---|---|---|
| H1 | walk-skill-tighten | codex | ⏸️ awaiting dispatch | yes — claude_code |
| H2 | walkthrough-skill | codex | ⏸️ awaiting dispatch | yes — claude_code |
| H3 | retire-doe-bench | codex | ⏸️ awaiting dispatch | yes — claude_code |
| H4 | document-standalone | codex | ⏸️ awaiting dispatch | yes — claude_code |
| H5 | cross-agent-verify | codex (authors + executes) | ⏸️ awaiting dispatch | yes — claude_code |

**Status legend:** `⏸️ awaiting dispatch` → `🏃 executing` → `✅ executed; verification-pending` → `✅ PASS (verifier)` → `done`.

## Acceptance criteria per piece (for claude_code verifier)

### H1

- `grep -E "ANTHROPIC_API_KEY|anthropic|openai|claude-haiku|claude-sonnet|gpt-" commands/walk.md` → 0 matches.
- `commands/walk.md` body names the connect → snapshot → plan → act → re-snapshot → predicate-or-done loop explicitly.
- Success policy described: "stop on host LLM emitting `done` rationale OR predicate match."
- Retry guidance: "on action failure, re-snapshot and replan once before declaring failure."
- No user-facing jargon (`AX`, `MCP`, `JSON-RPC`, `daemon`, `stdio`, `IPC`).

### H2

- `skills/host-walkthrough/SKILL.md` exists with valid YAML frontmatter (`name`, `description`, `user-invocable: false`).
- Description field includes ≥3 trigger phrases.
- Body has worked example for a web target AND a macOS target.
- Cites `WalkthroughSuccessPolicy.evaluate` (Swift symbol) or `references/success-policy.md` for behavioral parity.
- `grep -rE "ANTHROPIC_API_KEY|anthropic\.com|openai\.com" skills/host-walkthrough/` → 0 matches.

### H3

- `.build-loop/experiments/walkthrough-bench/` does not exist.
- `archive/walkthrough-bench-anthropic-direct/README.md` exists, names the shape mismatch, references the host-routed path.
- `package.json` no longer has `bench:walkthrough` or `bench:walkthrough:analyze` scripts.
- `npm test` green; `tsc --noEmit` clean.
- `docs/HANDOFF.md` updated (or removed) — no stale references to the retired bench.

### H4

- Top-of-file comment in `WalkthroughPlanner.swift` marks it standalone-app-only with one-line rationale.
- Top-of-file comment in `AnthropicClient.swift` same.
- `README.md` has a "Routing" section explaining host vs standalone, when each applies, and that `ANTHROPIC_API_KEY` is only the fallback path.
- `xcodebuild test -scheme Spectra` → 27/27 green (no behavior change).

### H5

- `tests/cross-agent/walkthrough.md` exists, complete enough for Codex (and Claude Code) to drive end-to-end.
- `scripts/verify_cross_agent.sh` exists, executable (`chmod +x`), exits 0 when run.
- claude_code re-runs `scripts/verify_cross_agent.sh` independently and gets exit 0.
- Rally feedback log contains a Codex execution entry citing: which steps ran, session ID, capture artifact path, any variances.

## Anti-checklist

- No new MCP tools — wire to the 12 existing.
- No new vendor SDK clients — host-routed must work zero-key.
- No revert of P3 `src/` or `macos/` validity fixes — those survive.
- No touching macOS Views or web-ui components.
- No silent scope creep — surface as VARIANCE first.

---

## Verifier feedback log

<!-- Append-only. Verifier posts entries below per the format in Coordination Protocol. -->
