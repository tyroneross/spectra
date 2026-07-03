// macos/Spectra/DaemonCore/HandlerRegistry.swift
//
// M3.G1 — the op→handler dispatch table. Handlers are pure functions of
// (params, context) returning a JSON-serializable result or throwing a
// DaemonApiError. The parallel G1 handler groups (session store, permissions,
// window list, library) plug in here without touching the socket server.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation
import CoreGraphics

/// Shared daemon state passed to every handler. G1 fills this incrementally
/// (SessionStore, LibraryStore, PermissionProvider, WindowProvider). Held behind
/// the registry so the socket server stays state-free.
final class DaemonContext: @unchecked Sendable {
    let sessions = SessionStore()
    let library = LibraryStore()
    let startedAt = Date()
    // Test-seed hook: when SPECTRA_CONFORMANCE_SEED=1, the oracle can seed a
    // deterministic session so getSession/getRun reach a populated success shape
    // (the external-daemon analog of the in-process fixture — see
    // docs/plans/m3-external-daemon-seeding.md Tier-2 option A).
    let conformanceSeedEnabled = ProcessInfo.processInfo.environment["SPECTRA_CONFORMANCE_SEED"] == "1"

    init() {
        // Capability-enforcement boot gate (M3.G1 flip, S2): force
        // CapabilityPolicy's lazy `shared` singleton to initialize NOW, during
        // daemon boot (main.swift constructs DaemonContext before the socket
        // starts accepting connections) — so a malformed
        // SPECTRA_CONFORMANCE_UNIX_CAPS value fails the process closed at
        // start time (clear stderr, nonzero exit) rather than lazily on the
        // first request. See CapabilityPolicy.swift.
        CapabilityPolicy.validateAtBoot()
    }
}

/// A handler: params (raw JSON value or nil) → JSON-serializable result, or throws.
typealias Handler = @Sendable (_ params: Any?, _ ctx: DaemonContext) throws -> Any

struct OperationEntry {
    let handler: Handler
    let requiredCapabilities: [Capability]
}

// Capability enforcement (M3.G1 flip, S2) happens at the DISPATCH call site
// (S1's Router.swift), not inside this registry: `entry(for:)` returns
// `requiredCapabilities`, and the caller does
// `try CapabilityPolicy.shared.assert(entry.requiredCapabilities, operation:
// operation)` BEFORE invoking `entry.handler` — mirroring src/daemon/security.ts's
// assertCapabilities-before-params order. See CapabilityPolicy.swift.

/// The op→handler table. Registering an op here makes it routable. The set of
/// registered ops IS the milestone surface: G1 registers the 11 control-plane ops;
/// unregistered ops return not_found (the routing table keeps them on the TS
/// daemon per the strangler plan).
final class HandlerRegistry: @unchecked Sendable {
    private var table: [String: OperationEntry] = [:]

    func register(_ operation: String, capabilities: [Capability], _ handler: @escaping Handler) {
        table[operation] = OperationEntry(handler: handler, requiredCapabilities: capabilities)
    }

    func entry(for operation: String) -> OperationEntry? { table[operation] }
    var registeredOperations: [String] { Array(table.keys).sorted() }
}

// ─── health (G1) ─────────────────────────────────────────────────────────────
// HealthResult = { apiVersion: 2, aquaSession: bool, daemonVersion: string,
//   ok: bool, permissions?: PermissionStatus[] }. Permissions omitted in the
// skeleton (optional) — the permissions provider (parallel group) fills it.

enum DaemonBuild {
    static let version = "0.3.2-swift-g1"
}

/// Run a command and return trimmed stdout (nil on failure). Used for the real
/// aquaSession / WindowServer probes below (mirrors TS health.ts's launchctl +
/// pgrep shell-outs).
private func runCommand(_ path: String, _ args: [String]) -> String? {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: path)
    proc.arguments = args
    let out = Pipe()
    proc.standardOutput = out
    proc.standardError = Pipe()
    do { try proc.run() } catch { return nil }
    proc.waitUntilExit()
    let data = out.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
}

func registerHealth(_ registry: HandlerRegistry) {
    registry.register("health", capabilities: [.daemonRead]) { params, ctx in
        // Mirrors src/daemon/health.ts EXACTLY (not fabricated): aquaSession via
        // `launchctl managername` == "aqua"; windowServer via `pgrep -x WindowServer`
        // (only when aqua, else connected:false + error); ok = windowServer.connected.
        // Hardcoding ok:true/aquaSession:false masks the daemon's real GUI-session
        // health signal — the Fable gate's FAIL trigger. `includePermissions`
        // returns the real TCC statuses from the same source as getPermissions.
        let aquaSession = runCommand("/bin/launchctl", ["managername"])?.lowercased() == "aqua"
        var windowServer: [String: Any]
        if aquaSession {
            let running = (runCommand("/usr/bin/pgrep", ["-x", "WindowServer"])?.isEmpty == false)
            windowServer = running ? ["connected": true] : ["connected": false, "error": "WindowServer process not found"]
        } else {
            windowServer = ["connected": false, "error": "launchctl manager is not Aqua; daemon is likely outside the GUI session"]
        }
        let connected = (windowServer["connected"] as? Bool) ?? false

        var result: [String: Any] = [
            "apiVersion": Wire.apiVersion,
            "aquaSession": aquaSession,
            "daemonVersion": DaemonBuild.version,
            "ok": connected,
            "pid": Int(ProcessInfo.processInfo.processIdentifier),
            "uptimeSec": Int(Date().timeIntervalSince(ctx.startedAt)),
            "windowServer": windowServer,
        ]
        if let obj = params as? [String: Any], obj["includePermissions"] as? Bool == true {
            result["permissions"] = permissionStatuses(filter: nil)
        }
        return result
    }
}
