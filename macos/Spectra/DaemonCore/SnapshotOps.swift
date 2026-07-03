// macos/Spectra/DaemonCore/SnapshotOps.swift
//
// M3.G2 (S2) — the `snapshot` op handler, plus the ONE frozen `registerAxOps`
// hook (DriverProtocol.swift §5: "registerAxOps ... bundles snapshot+act+
// computerUse, S2's WHOLE AX-engine surface"). Swift can only define a given
// free function once, so `registerAxOps` lives here and delegates to
// `registerActHandler` (ActOps.swift) and `registerComputerUseHandler`
// (ComputerUseOps.swift) — each op's own handler body stays in its own file;
// only the single cross-file entry point lives in one place.
//
// Handler is a pure driver passthrough + serialization, mirroring
// src/mcp/tools/snapshot.ts's handleSnapshot: resolve the driver, snapshot(),
// serialize via SnapshotSerialize (parity with src/core/serialize.ts),
// optionally attach a base64 screenshot.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// The one frozen entry point S6 wires (DriverProtocol.swift §5). Registers
/// all 3 of S2's op handlers.
func registerAxOps(_ registry: HandlerRegistry) {
    registerSnapshotHandler(registry)
    registerActHandler(registry)
    registerComputerUseHandler(registry)
}

func registerSnapshotHandler(_ registry: HandlerRegistry) {
    registry.register("snapshot", capabilities: [.uiRead]) { params, ctx in
        let dict = axParamsDict(params)
        guard let sessionId = dict["sessionId"] as? String, !sessionId.isEmpty else {
            throw DaemonApiError(.badRequest, "sessionId is required", status: 400)
        }
        // Session/driver resolution: ctx.driverRegistry.get(sessionId) — the
        // Swift analog of the TS daemon's `ctx.drivers.get(sessionId)`. A miss
        // here (for an affinity-routed request) means "no driver registered",
        // which S6's Router only ever dispatches natively after a
        // SessionStore hit — so this IS the not-found case, matching
        // src/mcp/tools/snapshot.ts's `if (!driver) throw ...`.
        guard let driver = ctx.driverRegistry.get(sessionId) else {
            throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
        }

        let wantsScreenshot = (dict["screenshot"] as? Bool) ?? false

        let snap: DriverSnapshot
        do {
            snap = try driver.snapshot()
        } catch {
            // Driver.snapshot() throwing is an infrastructure-level failure
            // (frozen contract: "never returns a partially-populated
            // DriverSnapshot on success — either throws, or returns a
            // fully-formed one") — surfaced as internal_error, not masked.
            throw DaemonApiError(.internalError, "snapshot failed: \(error)", status: 500)
        }

        // SnapshotResult = { snapshot: string, elementCount, url?, appName?,
        // screenshot? } (src/mcp/tools/snapshot.ts).
        var result: [String: Any] = [
            "snapshot": SnapshotSerialize.serializeSnapshot(snap),
            "elementCount": snap.elements.count,
        ]
        if let url = snap.url { result["url"] = url }
        if let appName = snap.appName { result["appName"] = appName }

        if wantsScreenshot {
            do {
                let data = try driver.screenshot()
                result["screenshot"] = data.base64EncodedString()
            } catch {
                throw DaemonApiError(.internalError, "screenshot failed: \(error)", status: 500)
            }
        }

        return result
    }
}

// ─── Param helpers (shared by ActOps.swift / ComputerUseOps.swift) ─────────

func axParamsDict(_ params: Any?) -> [String: Any] {
    (params as? [String: Any]) ?? [:]
}
