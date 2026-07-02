// macos/Spectra/DaemonCore/main.swift
//
// M3.G1 — Swift daemon-core entry point. Registers the G1 op surface and serves
// it over the unix socket. Socket path resolution (highest precedence first):
//   1. SPECTRA_DAEMON_SOCKET env  (the M2B conformance oracle points here)
//   2. $HOME/.spectra/daemon.sock (the frozen primary path)
//
// Run: swiftc macos/Spectra/DaemonCore/*.swift -o /tmp/spectra-daemon && \
//      SPECTRA_DAEMON_SOCKET=/tmp/x.sock /tmp/spectra-daemon
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

func resolveSocketPath() -> String {
    let env = ProcessInfo.processInfo.environment
    if let explicit = env["SPECTRA_DAEMON_SOCKET"], !explicit.isEmpty { return explicit }
    let home = env["HOME"] ?? NSHomeDirectory()
    let dir = (home as NSString).appendingPathComponent(".spectra")
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    return (dir as NSString).appendingPathComponent("daemon.sock")
}

let registry = HandlerRegistry()
let context = DaemonContext()

// ─── G1 op surface ───────────────────────────────────────────────────────────
// The set registered here IS the Swift daemon's milestone surface. Everything
// else stays on the TS daemon via the routing table (strangler cutover).
registerHealth(registry)
registerSessionOps(registry)      // listSessions/getSession/getRun/closeSession/closeAllSessions/recordLlmUsage
registerLibraryOps(registry)      // library
registerPermissionOps(registry)   // getPermissions/requestPermissions/listWindows

let server = SocketServer(registry: registry, context: context)
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
