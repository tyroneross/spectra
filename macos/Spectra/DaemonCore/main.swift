// macos/Spectra/DaemonCore/main.swift
//
// M3.G1 flip — Swift daemon-core entry point: the front door (ADR-01). Registers
// the G1 op surface, loads the fail-closed routing table (Router/D-01, T-02b),
// and serves the unix socket — natively for routed ops, byte-tunneled to the TS
// backend for everything else (incl. SSE /events). Socket path resolution
// (highest precedence first):
//   1. SPECTRA_DAEMON_SOCKET env  (the M2B conformance oracle points here)
//   2. $HOME/.spectra/daemon.sock (the frozen primary path)
//
// §Env Contract (this file's reads):
//   SPECTRA_ROUTING_CONFIG        — path to the D-01 routing JSON; absent →
//                                   compiled-in 5-op native default
//   SPECTRA_PROXY_BACKEND_SOCKET  — TS backend unix socket for proxied ops;
//                                   absent → proxied ops resolve not_found
//                                   (preserves pre-flip Gate-A behavior)
//   SPECTRA_DUAL_RUN              — "1" → shadow-diff the 3 native read ops
//                                   (health/getPermissions/listWindows) against
//                                   the TS backend, log-only, to
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

// ─── D-01 routing config: fail-closed load (T-02b) ───────────────────────────
// ANY of {malformed JSON, unrecognized shape, unsupported version, a
// session-coupled op present in native:[]} MUST refuse to boot — nonzero exit,
// clear stderr, launchd surfaces it. This is the split-brain guard: Swift
// already registers live SessionStore-backed handlers below, so an
// unconstrained routing table would let a one-line config edit silently serve
// wrong-but-well-formed session answers.
let router: Router
do {
    router = try Router.loadConfig(environment: env)
} catch {
    FileHandle.standardError.write(Data("[spectra-daemon] fatal: routing config refused: \(error)\n".utf8))
    exit(1)
}

let registry = HandlerRegistry()
let context = DaemonContext()

// ─── G1 op surface ───────────────────────────────────────────────────────────
// The set registered here IS the Swift daemon's milestone surface. The Router
// above decides which of these actually serve real traffic vs proxy to TS;
// everything unregistered here stays on the TS daemon via the routing table
// (strangler cutover) regardless of what the config says.
registerHealth(registry)
registerSessionOps(registry)      // listSessions/getSession/getRun/closeSession/closeAllSessions/recordLlmUsage
registerLibraryOps(registry)      // library
registerPermissionOps(registry)   // getPermissions/requestPermissions/listWindows

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
