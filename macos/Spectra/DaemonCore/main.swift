// macos/Spectra/DaemonCore/main.swift
//
// M3.G1 flip (+ M3.G2 store-presence routing) — Swift daemon-core entry point:
// the front door (ADR-01). Registers the G1 + G2 op surface, loads the
// fail-closed routing table (Router v2/D-01/D-03, T-02b/T-23), wires the G2
// RecordingOwnership installation path (§6b), and serves the unix socket —
// natively for routed ops, store-presence-affinity-routed for session/
// recording-scoped ops, byte-tunneled to the TS backend for everything else
// (incl. SSE /events). Socket path resolution (highest precedence first):
//   1. SPECTRA_DAEMON_SOCKET env  (the M2B conformance oracle points here)
//   2. $HOME/.spectra/daemon.sock (the frozen primary path)
//
// §Env Contract (this file's reads):
//   SPECTRA_ROUTING_CONFIG        — path to the D-01/D-03 routing JSON; absent
//                                   → compiled-in 5-op v1 native default
//                                   (G1-identical rollback target, unchanged
//                                   by G2). v2 configs add affinity/merge/
//                                   fanout buckets; v1 configs stay valid
//                                   verbatim (T-28, <2 min rollback drill).
//   SPECTRA_PROXY_BACKEND_SOCKET  — TS backend unix socket for proxied/
//                                   store-miss ops; absent → those ops resolve
//                                   not_found (preserves pre-flip Gate-A
//                                   behavior)
//   SPECTRA_DUAL_RUN              — "1" → shadow-diff the dual-run-eligible
//                                   native read ops (health/getPermissions/
//                                   listWindows/replayTerminal) against the TS
//                                   backend, log-only, to
//                                   ~/.spectra/logs/dual-run.jsonl (D-02)
//
// Run: swiftc macos/Spectra/DaemonCore/*.swift -o /tmp/spectra-daemon && \
//      SPECTRA_DAEMON_SOCKET=/tmp/x.sock /tmp/spectra-daemon
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

let env = ProcessInfo.processInfo.environment

func resolveSocketPath() -> String {
    if let explicit = env["SPECTRA_DAEMON_SOCKET"], !explicit.isEmpty { return explicit }
    let home = env["HOME"] ?? NSHomeDirectory()
    let dir = (home as NSString).appendingPathComponent(".spectra")
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    return (dir as NSString).appendingPathComponent("daemon.sock")
}

/// Fixed path for the D-02 dual-run divergence log (not env-overridable — the
/// plan pins this location so soak evidence collection always knows where to
/// look): ~/.spectra/logs/dual-run.jsonl.
func resolveDualRunLogPath() -> String {
    let home = env["HOME"] ?? NSHomeDirectory()
    let dir = (home as NSString).appendingPathComponent(".spectra/logs")
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    return (dir as NSString).appendingPathComponent("dual-run.jsonl")
}

let registry = HandlerRegistry()
let context = DaemonContext()

// ─── G1 + G2 op surface ────────────────────────────────────────────────────
// The set registered here IS the Swift daemon's milestone surface. Router v2's
// unregisteredAffinityOp invariant (T-23) checks against THIS registry, so
// every register call below MUST run BEFORE `Router.loadConfig` — reordered
// from G1 (which loaded the router first; G1's compiled-in default never
// referenced the registry, so the order didn't matter there).
registerHealth(registry)
registerSessionOps(registry)      // listSessions/getSession/getRun/closeSession/closeAllSessions/recordLlmUsage
registerLibraryOps(registry)      // library
registerPermissionOps(registry)   // getPermissions/requestPermissions/listWindows

// M3.G2 — the 5 W0-frozen register hooks (DriverProtocol.swift §5), wired in
// the frozen order. `registerCaptureRecordingOps` is the ONE asymmetric hook
// that RETURNS its concrete RecordingOwnership conformer (S4's registries do
// not know DaemonContext's field name) — S6 wires it explicitly, at boot,
// strictly before `server.start(...)` (§6b installation path).
registerConnectOps(registry)      // S1: createSession
registerAxOps(registry)           // S2: snapshot, act, computerUse
registerStepOps(registry)         // S3: step, llmStep, walkthrough, observe, analyze, discover
let recordingOwnership = registerCaptureRecordingOps(registry) // S4: screenshot, startRecording, stopRecording, getRecording
context.recordingOwnership = recordingOwnership
registerTerminalOps(registry)     // S5: recordTerminal, replayTerminal

// ─── D-01/D-03 routing config: fail-closed load (T-02b/T-23) ─────────────────
// ANY of {malformed JSON, unrecognized shape, unsupported version, a
// session-coupled op present in native:[], an op duplicated across buckets, an
// affinity/merge/fanout op with no registered handler} MUST refuse to boot —
// nonzero exit, clear stderr, launchd surfaces it. This is the split-brain
// guard: Swift already registers live SessionStore-backed handlers above, so
// an unconstrained routing table would let a one-line config edit silently
// serve wrong-but-well-formed session answers. v1 configs
// (`{"version":1,"native":[...]}`) stay valid verbatim — the rollback target
// (T-28, <2 min drill).
let router: Router
do {
    router = try Router.loadConfig(environment: env, registry: registry)
} catch {
    FileHandle.standardError.write(Data("[spectra-daemon] fatal: routing config refused: \(error)\n".utf8))
    exit(1)
}

let proxyBackendSocket = env["SPECTRA_PROXY_BACKEND_SOCKET"]
let dualRunEnabled = env["SPECTRA_DUAL_RUN"] == "1"
let dualRunRecorder: DualRunRecorder? = dualRunEnabled ? DualRunRecorder(logPath: resolveDualRunLogPath()) : nil

let server = SocketServer(
    registry: registry,
    context: context,
    router: router,
    proxyBackendSocket: proxyBackendSocket,
    dualRunEnabled: dualRunEnabled,
    dualRunRecorder: dualRunRecorder
)
let socketPath = resolveSocketPath()

// Clean shutdown: remove the socket file on SIGTERM/SIGINT.
signal(SIGPIPE, SIG_IGN)
for sig in [SIGTERM, SIGINT] {
    signal(sig) { _ in
        // best-effort unlink handled by next bind; just exit.
        exit(0)
    }
}

do {
    try server.start(socketPath: socketPath)
} catch {
    FileHandle.standardError.write(Data("[spectra-daemon] fatal: \(error)\n".utf8))
    exit(1)
}
