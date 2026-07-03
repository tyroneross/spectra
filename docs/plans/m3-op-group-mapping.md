# M3 entry task — definitive op→group mapping (from the core-impl import graph)

Derived from `src/daemon/core-impl.ts` delegation + each handler's import graph
(`src/mcp/tools/*.ts`), not the plan's "indicative" grouping. This is the
cutover order for the per-op routing table in `LaunchAgentManager`.

## Key finding — the CDP/M4 dependency is a SINGLE seam

`new CdpDriver()` is constructed in exactly ONE place: `src/mcp/tools/connect.ts:122`
(createSession, `driverType==='cdp'`). Every other op resolves its driver through
the `Driver` abstraction (`ctx.drivers.get(sessionId)`) and never imports `src/cdp`.
**Consequence:** the capture ops (snapshot/act/step/screenshot/observe/…) are
driver-agnostic — they do NOT individually block on M4. Only **createSession's web
path** (instantiating `CdpDriver`) and the **web-session coverage** of those ops
block on M4. So G2 can port + verify against native/fake drivers independently, and
M4's `CdpDriver` slots in behind the same interface. This de-risks G2 (it was
indicatively lumped as blocking-adjacent to web).

Same shape for M5: pipeline/media-composite is concentrated in `demo`/`recordComposite`
(import `pipeline`); the rest of capture imports only `media` (capture/png encoding),
not the polish pipeline.

## Grouping (dependency-based; corrects the indicative plan)

### G1 — control-plane · zero driver/capture · flip first (11 ops)
`health` · `getPermissions` · `requestPermissions` · `listWindows` · `listSessions`
· `getSession` · `getRun` · `closeSession` · `closeAllSessions` · `recordLlmUsage`
· **`library`** (filesystem catalog only — no driver; the indicative plan mislabeled
it G2). All delegate to `handleSession`/permission/window providers/`handleLibrary`
with no `ctx.drivers` and no `src/cdp|pipeline|media` import.
- ❗ Correction vs indicative: `createSession` is NOT G1 — it constructs a driver
  (`connect.ts` → `CdpDriver`|`NativeDriver`). It is the driver-instantiation seam
  (see G2/G3).

### G2 — native capture/AX/vision · driver-abstraction + native path · no CDP/pipeline (16 ops)
`createSession` (macos/native target only) · `snapshot` · `observe` · `act` · `step`
· `llmStep` · `walkthrough` · `screenshot` · `analyze` · `discover` · `computerUse`
· `startRecording` · `stopRecording` · `getRecording` · `recordTerminal` · `replayTerminal`.
- Handlers import at most `intelligence` (scoring/framing) + `media` (capture/png
  encoding) + `computer-use` (AX bridge/vision) + `native` (recording) — NOT `cdp`,
  NOT `pipeline`.
- ❗ `replayTerminal` is filesystem-only (reads a `.cast`) — G1-eligible; kept in G2
  by domain (terminal-capture) but can flip with G1 if convenient.
- These ops' Swift handlers verify against the fake/native driver via the oracle
  WITHOUT M4.

### G3 — web/CDP · BLOCKS ON M4 (the CdpDriver port)
The `CdpDriver` implementation behind the `Driver` interface: `createSession`'s
**web target** path (`connect.ts:122`) + the **web-session variants** of every G2
capture op (same handler, CDP driver instance). No NEW ops — G3 is the web *coverage*
of G2's ops once M4 lands. Flip web sessions per the routing table after M4 accepted.

### G4 — demo/composite/polish · BLOCKS ON M5 (the pipeline port) (3 ops)
`recordComposite` · `demo` · `autoRampDemo`. `demo`→`recordComposite`/`handleDemo`
and the composite path import `pipeline` + `media` + `native`. Flip after M5 accepted.

## Recommended cutover order
1. **G1** (11 ops) — control-plane; smallest surface, no driver, immediate native
   control-plane value. First Swift daemon-core skeleton (unix socket + these ops).
2. **G2** (16 ops) — the capture/AX bulk against native/fake drivers; the largest
   Swift port but independently verifiable (no M4/M5 wait).
3. **G3** — enable web-session coverage once **M4** (Codex) lands + is accepted.
4. **G4** (3 ops) — once **M5** (Codex) lands + is accepted.
   Then all 30 route to Swift → M5-retirement → M6.

## Prerequisite for verifying ANY group against Swift
The oracle currently seeds fixtures **in-process** (fake daemon only). Before G1
can be Fable-accepted against a Swift daemon, the oracle needs the **external-daemon
wire-seeding** (Tier-1 in `docs/plans/m3-external-daemon-seeding.md`). That is the
gating next step, independent of the Swift port itself.

## Scope note
Daemon behavioral surface to port ≈ **16.3k LOC** TS (`src/daemon` + `mcp/tools` +
`core`/`cdp`/`pipeline`/`intelligence`/`computer-use`/`media`). G1 is a small slice;
G2 is the bulk.
