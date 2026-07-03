// macos/Spectra/DaemonCore/ActOps.swift
//
// M3.G2 (S2) — the `act` op handler (registered via SnapshotOps.swift's
// frozen `registerAxOps` hook). Pure driver passthrough + serialization,
// mirroring src/mcp/tools/act.ts's handleAct's driver-facing slice: resolve
// the driver, invoke act(), serialize the resulting snapshot. Decision/step
// recording into the session (act.ts's `ctx.sessions.addDecision`/`addStep`
// calls) is OUT OF SCOPE here — that's S1's SessionStore write surface,
// consumed from the step-intelligence side (S3), not this op; this op's job
// is exactly the driver contract, matching the SG-4 handoff note that S2 now
// owns "the snapshot + act handlers" as pure driver passthroughs.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

private let validActionTypeNames: [String] = DriverActionType.allCases.map(\.rawValue).sorted()

func registerActHandler(_ registry: HandlerRegistry) {
    registry.register("act", capabilities: [.uiAct]) { params, ctx in
        let dict = axParamsDict(params)
        guard let sessionId = dict["sessionId"] as? String, !sessionId.isEmpty else {
            throw DaemonApiError(.badRequest, "sessionId is required", status: 400)
        }
        guard let elementId = dict["elementId"] as? String, !elementId.isEmpty else {
            throw DaemonApiError(.badRequest, "elementId is required", status: 400)
        }
        guard
            let actionRaw = dict["action"] as? String,
            let action = DriverActionType(rawValue: actionRaw)
        else {
            throw DaemonApiError(
                .badRequest,
                "action must be one of: \(validActionTypeNames.joined(separator: ", "))",
                status: 400
            )
        }
        let value = dict["value"] as? String

        guard let driver = ctx.driverRegistry.get(sessionId) else {
            throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
        }

        let result: DriverActResult
        do {
            // Frozen contract: act() itself never throws for an
            // unknown/stale element or a rejected action — only for
            // infrastructure-level (transport) failure, which this daemon
            // op maps to internal_error.
            result = try driver.act(elementId: elementId, action: action, value: value)
        } catch {
            throw DaemonApiError(.internalError, "act failed: \(error)", status: 500)
        }

        // ActResult (wire) = { success, error?, snapshot: string } —
        // src/mcp/tools/act.ts's driver-facing result shape.
        var out: [String: Any] = [
            "success": result.success,
            "snapshot": SnapshotSerialize.serializeSnapshot(result.snapshot),
        ]
        if let err = result.error { out["error"] = err }
        return out
    }
}
