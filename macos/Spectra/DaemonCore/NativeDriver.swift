// macos/Spectra/DaemonCore/NativeDriver.swift
//
// M3.G2 (S2) — the real macOS `Driver` conformer. Drives the EXISTING
// spectra-native AX helper (native/swift/main.swift) as a subprocess via
// BridgeClient (ND-2: never in-process AXUIElement), mirroring
// `src/native/driver.ts`'s NativeDriver method-for-method: connect() eagerly
// probes with a snapshot call; snapshot() assigns sequential e1..eN ids and
// caches an id->AX-path map; act() maps click/type/clear to native
// press/setValue verbs, resolves via the cached path, and NEVER throws for
// an unknown/stale id or a rejected native action (frozen Driver contract,
// DriverProtocol.swift) — those degrade to success:false + a fresh
// re-snapshot; screenshot() reads back the helper's temp PNG file and
// deletes it; close()/disconnect() mirror driver.ts's "don't close the
// shared bridge on close(), only on disconnect()".
//
// Concurrency (W0 flag, DriverProtocol.swift Driver doc): SocketServer
// dispatches on a CONCURRENT queue, so two requests against the SAME
// sessionId run against the SAME NativeDriver instance (DriverRegistry is
// one-instance-per-session) concurrently. The corrupting case is internal
// mutable state — `idToPath` rebuilt by a snapshot() while a concurrent
// act() reads it — not the shared BridgeClient (already internally
// thread-safe via its own lock + id-correlation). `queue` below is a
// per-instance SERIAL DispatchQueue every Driver method routes through, so
// only one of THIS session's AX calls is ever in flight at a time; other
// sessions' NativeDriver instances have their own independent queues and
// are unaffected.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

enum NativeDriverError: Error, CustomStringConvertible {
    case invalidTarget(String)
    case badResponse(String)

    var description: String {
        switch self {
        case .invalidTarget(let message), .badResponse(let message):
            return message
        }
    }
}

final class NativeDriver: Driver, @unchecked Sendable {
    private let bridge: BridgeClient
    /// Per-session serialization (see file header). One queue per
    /// NativeDriver instance == one queue per session (DriverRegistry
    /// invariant: one Driver instance per sessionId).
    private let queue = DispatchQueue(label: "spectra.nativedriver.\(UUID().uuidString)")

    private var appName: String?
    private var idToPath: [String: [Int]] = [:]

    init(bridge: BridgeClient = .shared) {
        self.bridge = bridge
    }

    // MARK: - Driver

    func connect(target: SpectraDriverTarget) throws {
        try queue.sync {
            guard let name = target.appName, !name.isEmpty else {
                // Frozen contract: connect() validates EAGERLY and throws
                // immediately if the target shape is unusable (mirrors
                // driver.ts:41-43).
                throw NativeDriverError.invalidTarget("NativeDriver requires appName in target")
            }
            appName = name
            // Eager probe (mirrors driver.ts:47-49): connect() itself fails
            // if the app can't be reached at all, rather than deferring
            // failure to the first real snapshot()/act() call.
            _ = try bridge.send("snapshot", params: ["app": name])
        }
    }

    func snapshot() throws -> DriverSnapshot {
        try queue.sync { try snapshotLocked() }
    }

    func act(elementId: String, action: DriverActionType, value: String?) throws -> DriverActResult {
        try queue.sync {
            guard let path = idToPath[elementId] else {
                // Frozen contract: unknown/stale elementId -> success:false +
                // a FRESH re-snapshot, never a throw (mirrors driver.ts:88-96).
                let fresh = try snapshotLocked()
                return DriverActResult(
                    success: false,
                    error: "Element '\(elementId)' not found. Take a new snapshot — the UI may have changed.",
                    snapshot: fresh
                )
            }

            let nativeAction: String
            switch action {
            case .click: nativeAction = "press"
            case .type, .clear: nativeAction = "setValue"
            case .select, .scroll, .hover, .focus: nativeAction = action.rawValue
            }

            var params: [String: Any] = [:]
            if let appName { params["app"] = appName }
            params["elementPath"] = path
            params["action"] = nativeAction
            if action == .type, let value { params["value"] = value }
            if action == .clear { params["value"] = "" }

            do {
                let result = try bridge.send("act", params: params)
                // Brief settle delay for native UI to update after the
                // action (mirrors driver.ts:115's SwiftUI-view-refresh grace
                // period) before the mandatory post-action re-snapshot.
                Thread.sleep(forTimeInterval: 0.2)
                let fresh = try snapshotLocked()
                let success = (result["success"] as? Bool) ?? false
                if !success {
                    return DriverActResult(success: false, error: result["error"] as? String, snapshot: fresh)
                }
                return DriverActResult(success: true, error: nil, snapshot: fresh)
            } catch {
                // Frozen contract's documented residual case: prefer
                // success:false over a throw whenever the failure is
                // attributable to the element/action rather than the
                // transport — but this catch's own re-snapshot can itself
                // throw (driver.ts:123 has the identical residual), and that
                // throw is allowed to propagate as act()'s own `throws`.
                let fresh = try snapshotLocked()
                return DriverActResult(success: false, error: String(describing: error), snapshot: fresh)
            }
        }
    }

    func screenshot() throws -> Data {
        try queue.sync {
            var params: [String: Any] = [:]
            if let appName { params["app"] = appName }
            let result = try bridge.send("screenshot", params: params)
            guard let path = result["path"] as? String else {
                throw NativeDriverError.badResponse("screenshot response missing 'path'")
            }
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            try? FileManager.default.removeItem(atPath: path)
            return data
        }
    }

    func close() {
        queue.sync {
            appName = nil
            idToPath.removeAll()
            // Don't close bridge — shared across sessions (frozen contract
            // doc, Driver.close(), mirrors driver.ts:139-145).
        }
    }

    func disconnect() {
        queue.sync {
            appName = nil
            idToPath.removeAll()
        }
        bridge.close()
    }

    // MARK: - Internals (must run on `queue`)

    private func snapshotLocked() throws -> DriverSnapshot {
        var params: [String: Any] = [:]
        if let appName { params["app"] = appName }
        let result = try bridge.send("snapshot", params: params)

        let rawElements = (result["elements"] as? [[String: Any]]) ?? []
        idToPath.removeAll()
        var elements: [DriverElement] = []
        elements.reserveCapacity(rawElements.count)

        for (index, raw) in rawElements.enumerated() {
            let id = "e\(index + 1)"
            let pathRaw = (raw["path"] as? [Any]) ?? []
            idToPath[id] = pathRaw.map { ($0 as? NSNumber)?.intValue ?? 0 }

            let boundsRaw = (raw["bounds"] as? [Any])?.map(numberToDouble) ?? [0, 0, 0, 0]
            let bounds = DriverBounds(
                x: boundsRaw.count > 0 ? boundsRaw[0] : 0,
                y: boundsRaw.count > 1 ? boundsRaw[1] : 0,
                width: boundsRaw.count > 2 ? boundsRaw[2] : 0,
                height: boundsRaw.count > 3 ? boundsRaw[3] : 0
            )

            elements.append(DriverElement(
                id: id,
                role: RoleNormalize.normalizeRole(raw["role"] as? String ?? "", platform: .macos),
                label: raw["label"] as? String ?? "",
                value: raw["value"] as? String,
                enabled: raw["enabled"] as? Bool ?? true,
                focused: raw["focused"] as? Bool ?? false,
                actions: (raw["actions"] as? [String]) ?? [],
                bounds: bounds,
                parent: nil
            ))
        }

        return DriverSnapshot(
            url: nil,
            appName: appName,
            platform: .macos,
            elements: elements,
            timestampMs: JSON.nowMillis(),
            metadata: DriverSnapshotMetadata(elementCount: elements.count, stableAtMs: nil, timedOut: nil)
        )
    }
}

private func numberToDouble(_ any: Any) -> Double {
    if let n = any as? NSNumber { return n.doubleValue }
    if let d = any as? Double { return d }
    return 0
}

/// The frozen factory (DriverProtocol.swift §6a). S1's ConnectOps.swift calls
/// this for macos-target createSession; throws (not a two-phase
/// construct-then-connect) if the app can't be reached AT ALL — mirrors
/// driver.ts's connect() eagerly probing via a snapshot call rather than
/// deferring failure to the first real snapshot()/act() call. This factory
/// itself does not know about DaemonApiError — mapping a throw here to a
/// wire error code is S1's job (createSession's connect-time failure path).
func makeNativeDriver(appName: String) throws -> Driver {
    let driver = NativeDriver()
    try driver.connect(target: SpectraDriverTarget(appName: appName))
    return driver
}
