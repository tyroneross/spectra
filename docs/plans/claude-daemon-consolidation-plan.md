# Spectra Daemon Consolidation — Claude's Independent Plan

> PLAN ONLY (Assess + Plan). No code is changed by this document. This is Claude's
> independent plan, authored for alignment against an independent Codex plan.
> Author: Claude (Opus 4.8). Date: 2026-06-27. Repo: `/Users/tyroneross/dev/git-folder/spectra`.

## 0. Decision (already made, restated for grounding)

Spectra's durable architecture = **one persistent GUI-session daemon** that owns the
window-server / Aqua connection, live recordings, CDP sessions, native capture
workers, and display-keep-awake; **one internal CORE library**; and **thin adapters**
(MCP over Streamable HTTP, CLI, the SwiftUI menu-bar app, slash commands) that forward
every stateful operation to the daemon. This eliminates `CGS_REQUIRE_INIT`, the
black-frame / display-sleep failure, and the divergent per-surface behavior.

### Why this is the fix (root cause, verified in code — 2026-06-27)

`src/mcp/server.ts` constructs a module-level `const ctx = createContext()`
(`src/mcp/context.ts`: a fresh `SessionManager` + `drivers` + `launches`). Both the
stdio entry (`startStdio`) and the HTTP daemon (`startHttpServer` → `connectTransport`)
bind that **same singleton `server`/`ctx`** — but in **different processes**:

- `spectra` (bare) runs the stdio MCP server **inside Claude Code's process**. Tool
  handlers there instantiate drivers and **spawn the native binaries locally**
  (`src/native/bridge.ts`, `src/media/composite-recorder.ts`). That process is not
  guaranteed to be in a logged-in Aqua GUI session → `CGS_REQUIRE_INIT` and black
  frames when the display sleeps.
- `spectra daemon` runs under launchd `gui/<uid>` (`LaunchAgentManager.swift`) — the
  one place with a live window-server connection — but is reached today only by the
  SwiftUI app via `DaemonClient.swift`.

So the two surfaces run the **same code in two contexts with two state stores**, and
capture only works in one of them. The consolidation makes the **GUI-session daemon the
sole owner of core + native workers**, and turns every other surface into a forwarding
client of it (the `DaemonClient.swift` model, generalized).

---

## 1. Surface map — current 5 → target (1 core + 1 daemon + thin adapters)

| # | Current surface | Process / context today | Target role | Action |
|---|---|---|---|---|
| 1 | **MCP server (stdio)** — `spectra`, entry `dist/mcp/server.js` | Runs **in Claude Code's process**; own `ctx`; instantiates drivers; **spawns natives locally** | Thin **stdio→daemon proxy** | **REWRITE** as proxy. **DELETE** in-process core + local native spawns from this path. |
| 2 | **MCP server (HTTP daemon)** — `spectra daemon` (`src/mcp/http.ts`) | LaunchAgent `gui/<uid>`; own `ctx`; Streamable HTTP `POST /mcp` | **THE daemon** — canonical core + native-worker owner | **KEEP + harden**: single `CoreApi` instance, daemon-level keep-awake, TCC/permission reporting, supervised native workers. |
| 3 | **CLI** — `src/cli/index.ts` | Only selects transport (stdio vs daemon) | Thin **CLI→daemon forwarder** | **EXPAND** command surface (`connect/snapshot/act/step/capture/session/library/demo`); each forwards to daemon. |
| 4 | **Standalone Swift binaries** — `spectra-native`, `spectra-composite-capture` | Spawned by whichever Node process runs the tool | **Daemon-owned native worker** | **KEEP** the binaries. **DELETE** direct invocation from any **non-daemon** process. |
| 5 | **macOS menu-bar app** — `macos/Spectra/*` | SwiftUI; `DaemonClient` → HTTP `/mcp`; also hosts `LaunchAgentManager` | Thin client (**already the correct model**) + daemon lifecycle host | **KEEP**; minor contract-sync of `DaemonModels`; `LaunchAgentManager` stays. |
| + | **Slash commands** — `commands/*` | Invoke MCP/CLI | Unchanged surface, routed through the forwarders | **UPDATE** to call the forwarding CLI/MCP. |

### Delete / merge ledger

**DELETE / SEVER (named cross-side imports — verified by scope-audit 2026-06-27)**
- In-process core instantiation on the **stdio path**: the FE stdio rewrite **must delete
  `import { createContext } from './context.js'`** and stop threading `ToolContext`
  (`src/mcp/server.ts:5,22` — the *only* FE→BE edge into `context.ts`). Stdio becomes a
  proxy with **no core**.
- **Sever `import { connectTransport } from './server.js'` in the daemon** — today
  `src/mcp/http.ts:20,72` (BE) imports the FE-registered `server`/`ctx` singleton. The new
  BE daemon **constructs its own MCP server bound to `CoreApi`** and mounts the transport
  itself; it does **not** import `server.ts`. (This is the highest-risk cross-side edge.)
- **Sever FE→BE TS imports in `src/cli/index.ts`**: it imports `startHttpServer`
  (`http.ts`, BE) for `spectra daemon` and `getVersionInfo` (`version.ts`, BE). The
  daemon-launch path moves to a BE bin **spawned as a subprocess** (§3); `spectra version`
  reads the **frozen contract `apiVersion`** / `GET /api/version`, not a BE TS import.
- Drop the **dead `getMcpServer` export** (`server.ts:495` — zero importers).
- **Direct native-binary spawn from any non-daemon process** — `NativeBridge` and the
  composite recorder may be driven **only** from inside the daemon.
- The **full-display AVFoundation capture path** (full-screen `MediaCapture` in
  `native/swift/` and the `src/media` code that drives it) — superseded by the
  **window-isolated ScreenCaptureKit** composite path (`composite-capture/`).

**MERGE**
- Two `ctx` instances (stdio + daemon) → **one daemon-owned `CoreApi` singleton**.
- Per-spawn `caffeinate` wrap inside `composite-recorder.ts` → a **daemon-level display
  assertion** held for the lifetime of any active recording (covers all capture, not
  just composite).

**KEEP (unchanged or near-unchanged)**
- Streamable HTTP `POST /mcp` wire, bearer auth, `mcp-session-id` stateful mode — the
  daemon's IPC, already correct. *(Note: the transport-mount code in `src/mcp/http.ts`
  and the token logic in `src/cli/token.ts` MOVE under `src/daemon/` per §3 — the **wire
  contract** is unchanged, the **files** relocate.)*
- `DaemonClient.swift` / `DaemonModels.swift` — the reference thin-client.
- `LaunchAgentManager.swift` — daemon lifecycle.
- All capture/intelligence/library engines (`src/cdp`, `src/native`, `src/launcher`,
  `src/intelligence`, `src/media`, `src/terminal`, `src/library`) — they move *under*
  the daemon, their internals are unchanged.

---

## 2. The daemon contract

### 2.1 Wire (unchanged — reuse existing scaffolding)
- **Protocol:** MCP Streamable HTTP. `POST /mcp` (bearer), `GET /mcp` (SSE),
  `DELETE /mcp` (terminate). Stateful (`sessionIdGenerator` set → `mcp-session-id`).
- **Bind:** `127.0.0.1:47823` only.
- **Auth:** bearer token at `~/.spectra/daemon.token` (mode 0600), created by the
  daemon, read by every client. `Authorization: Bearer <token>` on all `/mcp`.

### 2.2 Control plane (extend)
- `GET /api/version` → `{ apiVersion:int, daemonVersion:string }` (no auth). **`apiVersion`
  is the skew gate** — already enforced by `DaemonClient.expectedApiVersion`.
- `GET /api/health` → extend to
  `{ ok, pid, uptime, guiSession:bool, permissions:{ screenRecording, accessibility }, activeSessions:int, keepAwake:bool }`.
  `guiSession` + `permissions` let any adapter render an actionable error instead of a
  raw `CGS_REQUIRE_INIT`.

### 2.3 How MCP and CLI forward to the daemon
Both adapters speak the **same MCP `tools/call`** over `POST /mcp` (the SwiftUI app
already does this). They are *clients*, not servers:
- **stdio MCP proxy** terminates Claude Code's stdio MCP session, then forwards each
  `tools/call` to the daemon over HTTP and streams the result back.
- **CLI** maps each subcommand to a `tools/call`.
- **SwiftUI app** is unchanged in shape (`DaemonClient.callTool`).
Stateful ops (recordings, CDP sessions, launches) live **only** in the daemon's
`CoreApi` singleton; adapters hold **no session state** beyond a `sessionId` string and
the cached `mcp-session-id`.

### 2.4 Daemon-owned responsibilities (moved IN)
- **Single `CoreApi` instance** constructed at boot (the one `SessionManager` + drivers
  + launches).
- **Native worker supervision** — `NativeBridge` (`spectra-native`) and the composite
  recorder are started/owned by the daemon, inside `gui/<uid>`.
- **Display keep-awake** — a daemon-level assertion (the `caffeinate -dis` strategy,
  raised to daemon scope) held while any recording is active; released when the last
  recording stops.
- **TCC permission UX** — the daemon triggers screen-recording + accessibility prompts
  in the GUI session and reports state via `/api/health`; the menu-bar app surfaces a
  grant CTA / deep-link.
- **Lifecycle** — `LaunchAgentManager` (`RunAtLoad` + `KeepAlive`); single label
  `dev.spectra.daemon`; port-bind guard prevents a second daemon.

### 2.5 The SHARED, FROZEN contract artifact (`src/contract/`) — the alignment lynchpin
Created **once** in Phase 0 (joint), then **frozen**. Both sides code against it.

1. **Tool I/O schemas** — for each tool (`connect, snapshot, act, step, walkthrough,
   llm_step, capture, analyze, discover, session, record, replay, library, demo`): a Zod
   **input** schema **and a Zod output schema**. Today only inputs are formalized (inline
   in `server.ts`) and outputs are ad-hoc — the freeze **adds output schemas**. This is
   the single source of truth both the daemon's tool router and every client bind to.
2. **`CoreApi` TS interface** — one method signature per tool op, derived 1:1 from the
   I/O schemas. The daemon implements it; the tool router calls it. (Clients never import
   `CoreApi`; they go over the wire — but freezing the schemas freezes `CoreApi`.)
3. **Control-plane schemas** — `version`, `health` (incl. `guiSession` + `permissions`).
4. **Error envelope** — `{ error, tool, hint, timestamp }` (already emitted by
   `server.ts`), formalized.
5. **`connect.repoPath` storage-anchoring contract** — documented so every adapter knows
   to pass `repoPath` (today only the SwiftUI app does), keeping artifacts in
   `<repo>/.spectra/` under a launchd daemon whose CWD is `$HOME`.
6. **`apiVersion` constant (CANONICAL here) + CONTRACT_CHANGELOG + freeze mechanism.**
   `apiVersion` lives in `src/contract/` as the *single* source of truth; `src/mcp/version.ts`
   (BE) imports it and only adds `daemonVersion` (package version). The Swift
   `DaemonClient.expectedApiVersion` and `DaemonModels` mirror this constant.
   **Freeze is mechanized, not by convention:** Phase 0 commits a checked-in
   `contract.snapshot.json` (a serialized JSON-Schema dump + content hash of every frozen
   Zod schema); `contract.test.ts` **diffs the live schemas against that snapshot and fails
   on any drift** unless `apiVersion` was bumped in the same change. This is what lets the
   FE and BE branches trust the boundary is stable while building in parallel.

---

## 3. Frontend (Claude) vs Backend (Codex) split — MECE file ownership

> **Rule:** disjoint write sets. The only shared files are the Phase-0 frozen contract
> (no edits after freeze) and four integration-owned files (§3.3). Build in parallel
> against the frozen contract; integrate at the §4 checkpoints.

### 3.0 SHARED — `src/contract/` (JOINT author in Phase 0, then FROZEN)
The frozen artifact has two halves, both authored at the Phase-0 joint checkpoint and
frozen by `contract.snapshot.json` thereafter:

| Sub-artifact | Primary author | Content |
|---|---|---|
| `src/contract/schemas.ts` | **FE (Claude)** | Tool I/O Zod schemas, error envelope, control-plane (`version`/`health`) schemas, `apiVersion` constant |
| `src/contract/core-api.ts` | **BE (Codex)** | The `CoreApi` TS interface (one method per tool op), derived 1:1 from the schemas |
| `src/contract/contract.snapshot.json` + `contract.test.ts` | **Joint** | Frozen schema snapshot + drift-detecting stability test |

After Phase 0 neither side edits `src/contract/` without an `apiVersion` bump + a re-sync
checkpoint. FE imports `schemas.ts`; BE implements `core-api.ts`. This is the only file
both sides author, and it is authored **before** the parallel branch.

### 3.1 FRONTEND — Claude (adapter surfaces, clients)

| Path | Role | New / Change |
|---|---|---|
| `src/client/daemon-client.ts` | TS daemon client (bearer, `mcp-session-id`, SSE parse) — mirror of `DaemonClient.swift` | **NEW** |
| `src/mcp/server.ts` | MCP tool registration **wiring** — imports input schemas **from `src/contract/`** (does not own them), points each handler at the daemon forwarder; **deletes** the `createContext` + `./tools/*` handler imports | **CHANGE** |
| `src/mcp/stdio-proxy.ts` | stdio MCP entry that forwards every `tools/call` to the daemon | **NEW** (replaces stdio's in-process execution) |
| `src/cli/index.ts` | CLI arg router — **forwarding subcommands only**; `spectra version` reads the contract `apiVersion` / `GET /api/version`; `spectra daemon` **execs the BE daemon bin as a subprocess** (no TS import of `startHttpServer`) | **CHANGE** |
| `src/cli/commands/*.ts` | Per-command forwarders (`connect/snapshot/act/step/capture/session/library/demo`) | **NEW** |
| `commands/*.md` | Slash commands | **CHANGE** — route through forwarding CLI/MCP |
| `macos/Spectra/Net/DaemonClient.swift`, `DaemonModels.swift` | Swift client adapter | **CHANGE** — sync `DaemonModels` + `expectedApiVersion` to the frozen schemas |
| `macos/Spectra/Views|ViewModels|LLM|Storage/*` | Menu-bar app UI (an adapter surface) | **CHANGE** (minimal) — permission CTA, health surfacing |

### 3.2 BACKEND — Codex (daemon engine, core, native, lifecycle)

| Path | Role | New / Change |
|---|---|---|
| `src/daemon/index.ts` | **Daemon launch bin** — the executable the LaunchAgent and `spectra daemon` **spawn as a subprocess** (replaces the FE→BE `startHttpServer` import). Boots `CoreApi`, mounts the MCP HTTP transport on a **freshly-constructed** MCP server (does **not** import FE `server.ts`/`connectTransport`), holds the process alive | **NEW** |
| `src/daemon/http.ts` (from `src/mcp/http.ts`) | HTTP transport mount, control plane (`/api/version`, `/api/health` + `guiSession`/`permissions`), tool router → `CoreApi` | **MOVE** |
| `src/daemon/context.ts` (from `src/mcp/context.ts`) | The one `CoreApi`/state wiring (`detectPlatform`, session/driver/launch maps) | **MOVE** |
| `src/daemon/auth.ts` (from `src/cli/token.ts` + its test) | Token create/verify; daemon owns create/verify, FE client only **reads** the token file | **MOVE** |
| `src/core/api.ts` | `CoreApi` **implementation** (one method per tool op) | **NEW** (impl of the frozen `src/contract/core-api.ts`) |
| `src/core/*` (`session, storage, actions, resolve, …`) | Session/state ownership | **CHANGE** (wired under `CoreApi`) |
| `src/mcp/tools/*.ts` | Tool **execution** logic extracted into `CoreApi` | **CHANGE** — core logic moves to `src/core/api.ts`; the input-schema halves move to `src/contract/schemas.ts` (done **jointly in Phase 0**, before the branch) |
| `src/mcp/resources.ts` | MCP resources (read `CoreApi`) | **CHANGE** (daemon-owned) |
| `src/mcp/version.ts` | `daemonVersion` only; **imports `apiVersion` from `src/contract/`** | **CHANGE** |
| `src/cdp/*`, `src/native/*`, `src/launcher/*`, `src/intelligence/*`, `src/media/*`, `src/terminal/*`, `src/library/*` | Capture/automation/storage **engines** | **CHANGE** (internals mostly unchanged; native spawns gated to daemon) |
| `native/swift/*` | Native capture workers; **delete** full-display AVFoundation path | **CHANGE/DELETE** |
| `macos/Spectra/Daemon/LaunchAgentManager.swift` | Daemon lifecycle (LaunchAgent) | **CHANGE** (keep-awake/perms hooks) |

### 3.3 SHARED / integration-owned (serialize edits — orchestrator applies both sides)
- `src/contract/*` — authored jointly in Phase 0 (§3.0), **frozen after** via
  `contract.snapshot.json`; no edits without an `apiVersion` bump + re-sync.
- `src/index.ts` — npm public exports (BE types + FE client export): union edit at integration.
- `package.json` (`bin`, `scripts`, `exports`), `.claude-plugin/plugin.json` /
  `.codex-plugin` (stdio entry path) — union edit at integration.
- `macos/Spectra.xcodeproj` / `project.yml` — Xcode project membership; serialize (both
  sides add files): coordinate via the integration checkpoint.

### 3.4 The frozen boundary between the two sides
**Frontend depends on the daemon only through `src/contract/` + the wire** (`POST /mcp`,
`/api/*`). **Backend depends on the contract only through `src/contract/` + `CoreApi`**.
Neither imports the other's modules. Therefore:
- FE builds against a **mock daemon** (validates requests against contract **input**
  schemas, returns contract-valid **output** fixtures) — no GUI session needed.
- BE builds `CoreApi` against the contract with in-process unit tests — no wire needed.
- They meet only at the §4 integration checkpoints.

---

## 4. Phased, dependency-ordered plan (with verification)

> **GUI-session capture-verify constraint:** any test that exercises real capture /
> recording / window-server access must run in a **logged-in Aqua GUI session**
> (`gui/<uid>`) with TCC granted — **not** over SSH / headless / console-less CI.
> Phases 0 and 2 (FE) verify **entirely without** a GUI session. Phase 1 (BE) needs a
> GUI session for **daemon-boot-under-launchd `gui/<uid>`, the `/api/health` `guiSession`
> assertion, TCC permission pre-flight, AND the live-capture E2E** — only its pure logic
> (param→flag mapping, luminance parse, tool-router dispatch) stays headless. Phase 3
> needs a GUI session for the cross-surface capture parity suite.

### Phase 0 — Contract Freeze  *(JOINT; blocking; before the parallel split)*
**Do:** Author `src/contract/` (§3.0) — tool I/O Zod schemas (add the missing **output**
schemas), the `CoreApi` interface, control-plane schemas, error envelope, `apiVersion`
+ CHANGELOG + `contract.snapshot.json`. Mechanically **split** each `src/mcp/tools/*.ts`
into schema (→ `src/contract/schemas.ts`) and execution (→ `src/core/api.ts` skeleton,
stubs throwing `NotImplemented`).
**Exit gates (all must hold before the FE/BE branch — these are the boundary cuts the
scope-audit flagged):**
1. `server.ts` imports input schemas **from `src/contract/`** and **no longer imports**
   `./tools/*` handlers or `./context.js` (`createContext`).
2. The daemon-mount no longer imports `connectTransport` from `server.ts` — `src/daemon/`
   constructs its own MCP server (the stub is enough to prove the import is gone).
3. Dead `getMcpServer` export removed.
4. `src/mcp/version.ts` imports `apiVersion` from `src/contract/`.
5. `contract.snapshot.json` committed; `contract.test.ts` passes.
**Verify (headless):** `tsc` clean; `contract.test.ts` drift check green; `CoreApi`
skeleton compiles; grep proves the four severed imports are gone. **No GUI session.**

### Phase 1 — Backend: daemon owns the singleton core  *(BE; parallel with Phase 2)*
**Do:** `src/daemon/` constructs **one** `CoreApi` at boot, mounts the MCP HTTP
transport, routes `tools/call` → `CoreApi`. Implement `CoreApi` against the engines.
Move keep-awake to **daemon scope** (assertion held while any recording is active).
Daemon **owns + supervises** `NativeBridge` and the composite recorder (gui/<uid> only).
Extend `/api/health` (`guiSession`, `permissions`). Add TCC pre-flight. Move
token create/verify to `src/daemon/auth.ts`.
**Verify:**
- Headless: `CoreApi` unit tests; `buildCompositeArgs` / `buildCaffeinatedCommand` /
  `parseLuminance` pure tests; tool-router dispatch tests.
- **GUI session required** (for boot, health, TCC, AND capture): daemon boots under
  launchd `gui/<uid>`; `GET /api/health` → `guiSession:true`, perms reported; TCC prompts
  fire in-session; a real `spectra_capture` + a real `record-composite` via `POST /mcp`
  produce **non-black** output (no `CGS_REQUIRE_INIT`, black-frame guard mean-luma ≥
  threshold).
**Exit:** the **daemon** capture path works end-to-end over the wire. *(The legacy
in-process stdio capture path still physically exists until the Phase-3 cutover deletes
it — Phase 1 proves the new path, Phase 3 removes the old one.)*

### Phase 2 — Frontend: thin adapters forward to the daemon  *(FE; parallel with Phase 1)*
**Do:** `src/client/daemon-client.ts` (bearer, `mcp-session-id`, SSE parse, version-skew
check, daemon-not-running → probe `/api/health` + actionable error / auto-bootstrap
LaunchAgent). `src/mcp/stdio-proxy.ts` registers the contract tool schemas; each handler
forwards via the client. `src/cli/commands/*` forwarders. Update `commands/*` slash
commands. Sync `DaemonModels.swift` to the frozen output schemas; add the menu-bar
permission CTA.
**Verify (headless):** FE unit + integration tests against the **mock daemon** (request
shapes validate against contract input schemas; responses parse against output schemas);
stdio-proxy forwards and round-trips a mocked `tools/call`; CLI maps each subcommand
correctly; version-skew + daemon-down paths return clear errors. **No GUI session.**
**Exit:** every adapter is a verified forwarder against the mock.

### Phase 3 — Integration & cutover  *(JOINT)*
**Do:** Point the stdio proxy + CLI + (already-correct) SwiftUI app at the **real**
daemon. Execute the deletes (§1 ledger): stdio in-process core, non-daemon native spawns,
full-display AVFoundation path. Apply the integration-owned edits (`index.ts`,
`package.json`, `plugin.json`, `.xcodeproj`). Confirm `apiVersion` skew handling.
**Verify (GUI session required for capture E2E):**
- **Cross-surface parity suite** — the same op (`connect` → `snapshot` → `capture` →
  `record-composite`) run via (a) MCP stdio (Claude Code), (b) MCP HTTP (SwiftUI app),
  (c) CLI → **identical session/state in the daemon, identical artifacts**, all in
  `<repo>/.spectra/`.
- No surface spawns a native binary in its own process (grep/trace: spawns originate
  only from `src/daemon/`).
- Display-sleep regression: start a recording, let the display idle → output not black
  (daemon keep-awake holds).
**Exit:** one core, one daemon, all surfaces forwarding; divergence gone.

### Phase 4 — Cleanup & docs  *(JOINT, low risk)*
**Do:** Remove dead code; update `README.md`, `CLAUDE.md`, `AGENTS.md`,
`docs/prd-spectra-composite.md` nav map; confirm `plugin.json` stdio entry still
completes the Claude Code MCP handshake (path stable, internals = proxy).
**Verify (headless):** `tsc` + `vitest` green; plugin loads; `spectra --help` lists the
forwarding surface; `mock-scanner` / dead-code scan clean.

---

## 5. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **GUI-session test dependency** — capture E2E can't run headless / in console-less CI | Split tests: headless unit (logic, schemas, mock daemon) vs **console-session E2E** gate; document a manual GUI-session verification step; keep pure helpers (param→flag, luminance) unit-testable without a session (already are). |
| 2 | **stdio proxy now depends on the daemon being up** — Claude Code MCP breaks if daemon down | Proxy probes `GET /api/health` on start; auto-bootstraps the LaunchAgent or returns a single actionable error (`daemon not running — open Spectra.app / run \`spectra daemon\``); never a raw `CGS_REQUIRE_INIT`. |
| 3 | **Contract drift TS ↔ Swift** — `DaemonModels.swift` diverges from `src/contract` output schemas | `apiVersion` skew gate (already in `DaemonClient`); a contract-conformance checklist in Phase 3; `DaemonModels` sync is an explicit FE task. |
| 4 | **Two daemons / stale binary** — a second `node … daemon` writes alongside the first | Single LaunchAgent label `dev.spectra.daemon`; port-bind guard (47823) fails fast on a second bind; `/api/health.pid` lets clients detect a restart and `resetSession`. |
| 5 | **Single-writer artifact placement** — only the daemon writes now; launchd CWD = `$HOME` | `repoPath` anchoring is part of the frozen `connect` contract (already implemented in `session.ts`); every adapter must pass `repoPath`; parity suite asserts artifacts land in `<repo>/.spectra/`. |
| 6 | **TCC permission UX** — prompts must fire in the GUI session, not the proxy/CLI | Daemon triggers prompts in `gui/<uid>`; `/api/health.permissions` reports state; menu-bar app shows a grant CTA / deep-link; adapters render "permission needed" instead of a crash. |
| 7 | **Backward-compat of the stdio entry** — `plugin.json` points at `dist/mcp/server.js` | Keep the entry **path** stable; only its internals change (now a proxy); Phase 4 re-verifies the Claude Code handshake. |
| 8 | **Shared-file merge contention** — both sides touch `index.ts` / `package.json` / `.xcodeproj` | Declared **integration-owned**; serialized union edits at the §4 checkpoint by the orchestrator, not by either side mid-flight. |

---

## 6. Open questions for cross-plan alignment (Claude ↔ Codex)

1. **Contract transport granularity** — keep MCP `tools/call` as the *only* daemon IPC
   (this plan), or add a leaner internal JSON-RPC for CLI/CI? This plan reuses `tools/call`
   to avoid a second protocol surface; flag if Codex's plan introduces a parallel RPC.
2. **`CoreApi` ownership of the schema↔impl split** — this plan does the `src/mcp/tools/*`
   split **jointly in Phase 0** to avoid a tug-of-war; confirm Codex agrees the split
   happens before the parallel branch, not during it.
3. **Where keep-awake lives** — daemon-level assertion (this plan) vs per-recording
   (today). Confirm Codex moves it to daemon scope so non-composite captures are covered.
4. **stdio proxy auto-bootstrap** — should the proxy be allowed to install/load the
   LaunchAgent, or only the menu-bar app? (Affects who owns `LaunchAgentManager` calls.)
```
