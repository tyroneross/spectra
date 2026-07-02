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
}

/// A handler: params (raw JSON value or nil) → JSON-serializable result, or throws.
typealias Handler = @Sendable (_ params: Any?, _ ctx: DaemonContext) throws -> Any

struct OperationEntry {
    let handler: Handler
    let requiredCapabilities: [Capability]
}

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

func registerHealth(_ registry: HandlerRegistry) {
    registry.register("health", capabilities: [.daemonRead]) { _, ctx in
        // HealthResult required: apiVersion(2), aquaSession, daemonVersion, ok,
        // pid, uptimeSec, windowServer{connected, error?}. permissions/startedAt
        // optional (permissions filled by the permissions group later).
        let uptimeSec = Int(Date().timeIntervalSince(ctx.startedAt))
        let displayConnected = CGMainDisplayID() != 0
        return [
            "apiVersion": Wire.apiVersion,
            "aquaSession": false,
            "daemonVersion": DaemonBuild.version,
            "ok": true,
            "pid": Int(ProcessInfo.processInfo.processIdentifier),
            "uptimeSec": uptimeSec,
            "windowServer": ["connected": displayConnected] as [String: Any],
        ] as [String: Any]
    }
}
