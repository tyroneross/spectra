# Aligned plan — Spectra daemon consolidation (Claude + Codex)

Canonical execution plan. Merges the two independent plans — `claude-daemon-consolidation-plan.md` (FE/contract/phasing) and `codex-daemon-consolidation-plan.md` (BE/REST contract/deletes) — and bakes in the API-security research + build-loop-memory precedent (Agent Rally Point daemon-first). Execution: **Claude = frontend, Codex (gpt-5.5 xhigh) = backend, cross-checking.**

## 1. Convergence (both plans agree — high confidence)
- The **GUI-session daemon is the sole owner** of the core + native capture workers (it has the Aqua/window-server connection → fixes `CGS_REQUIRE_INIT` + black frames). Verified root cause (Claude): `src/mcp/server.ts` module-level `ctx = createContext()` is bound by both stdio (runs in Claude Code's process, no Aqua) and the HTTP daemon — same code, different processes.
- **All 5 surfaces → thin forwarding clients**: stdio MCP, CLI, menu-bar app, slash commands. Standalone Swift binary → daemon-owned native worker.
- **Freeze a contract first, then build FE/BE in parallel.**
- **Delete**: the standalone-binary-direct path, the full-display AVFoundation path, per-spawn `caffeinate` (→ daemon keep-awake), dead exports.
- Phases: contract freeze → backend daemon ∥ frontend forwarders → integration/cutover/delete → cleanup.

## 2. Resolved alignment decisions (the differences)
| Question | Claude | Codex | **Aligned decision** |
|---|---|---|---|
| Daemon transport | stdio proxy → daemon | loopback TCP `:47823` + bearer + reject-non-loopback-Host | **Unix domain socket (`~/.spectra/daemon.sock`, `0600`) as primary** — OS-enforced single-user, immune to DNS-rebinding, no token-theft (Docker precedent). **stdio MCP adapter forwards over the socket** (zero network surface — what Claude Code spawns). **Loopback TCP + Streamable HTTP `/mcp` is OPT-IN** (off by default) for remote/HTTP MCP clients, and if enabled MUST: reject non-loopback Host + **validate Origin** (rmcp CVE GHSA-89vp-x53w-74fx) + bearer on every request + `0600` token file. |
| Contract mechanism | `src/contract/` {schemas.ts (FE), core-api.ts (BE)} frozen by `contract.snapshot.json` + drift `contract.test.ts` | REST `/api/v1/*` envelope + `apiVersion: 2` + SSE `/api/v1/events` | **Both**: `src/contract/` is the frozen source of truth (CoreApi TS interface + Zod I/O schemas + `apiVersion`); the wire shape is codex's enveloped `/api/v1/*` + SSE events, served over the unix socket. Snapshot + drift test gate every change. |
| Keep-awake scope | daemon-level | daemon-level | **Daemon-level, active only while ≥1 recording is live** (not per-spawn). |
| LaunchAgent bootstrap | open | LaunchAgentManager | **Menu-bar app bootstraps** (it runs in `gui/<uid>` — required for TCC/Aqua); `spectra daemon` subcommand for headless/dev. Default-deny: only the user's in-session app may bootstrap. |

## 3. Security posture (researched + BLM — non-negotiable acceptance criteria)
1. **Unix socket `0600`** primary; TCP opt-in with Origin+Host validation + bearer. ([MCP transports spec], [rmcp CVE], [Docker socket], [auth0].)
2. **TCC + GUI session is the mechanism**: daemon runs as LaunchAgent in `gui/<uid>`; capture children inherit its session + screen-recording grant. BLM gotcha *"daemon spawns children in daemon env"* → **verify the daemon actually launched inside Aqua** (health endpoint asserts window-server connectivity), never a stray env.
3. **Default-deny capability** (BLM rally daemon-first): daemon authority is explicit; adapters add no new authority; verify caller (socket peer / token).
4. **Anti-dormancy** (BLM): the daemon path is **CI-tested with a test-double daemon** honoring the real contract — never ships dormant (we hit dormant-feature defects repeatedly this session).
5. **Fail-open + `delivery_path` labeling** (BLM): adapters detect daemon-down → health-probe + auto-bootstrap + **actionable error (never raw `CGS_REQUIRE_INIT`)**; label which path served each op.
6. **Black-frame guard + resource bounds**: post-capture luminance check; bound concurrent recordings.

## 4. Frontend / Backend split (MECE) + frozen contract
**Phase 0 (joint, headless): author + freeze `src/contract/`.** FE primary-authors `schemas.ts` (tool I/O Zod + `apiVersion`); BE primary-authors `core-api.ts` (`CoreApi` interface) + the `/api/v1` envelope/event shapes. Freeze with `contract.snapshot.json` + `contract.test.ts` (drift gate). After freeze, write sets are disjoint.

- **Frontend (Claude) owns:** the TS daemon client, stdio MCP proxy (`server.ts` rewritten coreless), CLI forwarders (`cli/index.ts` → execs BE daemon bin; `version` reads contract constant), slash commands, `DaemonClient.swift` (menu-bar client), `schemas.ts`.
- **Backend (Codex) owns:** `src/daemon/*` (the daemon engine + unix-socket/HTTP server + auth + Origin/Host validation + health + keep-awake + TCC), the `CoreApi` impl, `src/core/*`, `src/cdp/*`, `src/launcher/*`, `src/native/*`, `src/media/*` engines, the Swift native workers (`native/swift/*`), `LaunchAgentManager.swift`, daemon install/build scripts, backend tests, `core-api.ts`.
- **Serialized integration-owned (one writer at a time):** `index.ts`, `package.json`, `plugin.json`, `.xcodeproj`.

## 5. Phases (dependency-ordered)
- **P0 — Contract freeze** (joint, headless): `src/contract/` + snapshot + drift test + boundary-cut exit gates.
- **P1 — Backend daemon owns core** (Codex; needs GUI session for boot/health/TCC/capture) ∥ **P2 — Frontend forwarders** (Claude; headless, against a mock daemon honoring the frozen contract).
- **P3 — Integration + cutover + deletes** (GUI session; cross-surface parity; sever stdio in-process core, FE→BE imports, dead exports, full-display AVFoundation path, non-daemon native spawns; merge two `ctx` → one).
- **P4 — Cleanup / docs.**

## 6. Verification
Split **headless-unit** (FE forwarders vs mock daemon; contract drift; arg→wire mapping) from **GUI-session E2E** (real capture, TCC, black-frame guard, cross-surface parity) — the latter can't run in console-less CI; runs on a GUI runner or via codex/operator. Each phase verified before the next.

## 7. Deletes (union of both plans)
`src/media/composite-recorder.ts` direct path · `build:composite` / `ensureCompositeBinary` / `compileComposite` / `COMPOSITE_BINARY_PATH` · `spectra_demo recordComposite` direct · web/macos AVFoundation recording helpers · stdio in-process `createContext` import · daemon's `connectTransport` import from FE `server.ts` · FE→BE imports in `cli/index.ts` · dead `getMcpServer` export · all non-daemon native spawns · per-spawn `caffeinate`.

## 8. Open items for execution kickoff
- Confirm the unix-socket-primary transport decision (vs codex's TCP:47823) — recommended above.
- P0 is joint: FE + BE co-author the contract, then freeze before parallel work.
