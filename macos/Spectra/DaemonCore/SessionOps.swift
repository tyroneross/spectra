// macos/Spectra/DaemonCore/SessionOps.swift
//
// M3.G1 — session control-plane ops: listSessions, getSession, getRun,
// closeSession, closeAllSessions, recordLlmUsage. Mirrors the behavior +
// result shapes of src/daemon/core-impl.ts's session methods (which delegate
// to src/mcp/tools/session.ts's handleSession) against DaemonContext.sessions
// (SessionStore.swift). Honors DaemonContext.conformanceSeedEnabled to seed a
// deterministic `conformance-seed` session so getSession/getRun can be
// verified against a populated shape (see SessionStore.ensureConformanceSeed).
//
// M3.G2 (S1) addition: closeSession/closeAllSessions now ALSO tear down this
// session's native Driver (if any) via `ctx.driverRegistry`, mirroring
// src/mcp/tools/session.ts's 'close'/'close_all' actions (`driver.close()` +
// `ctx.drivers.delete(id)` BEFORE `ctx.sessions.close(id)`). A driver-registry
// miss is a normal case (proxied/web session, or a macOS `record:true`
// session that never registered a driver in the first place — ConnectOps.swift)
// — not an error condition this handler needs to special-case.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

func registerSessionOps(_ registry: HandlerRegistry) {
    registry.register("listSessions", capabilities: [.sessionsRead]) { _, ctx in
        ctx.sessions.ensureConformanceSeed(enabled: ctx.conformanceSeedEnabled)
        // ListSessionsResult = { sessions: SessionSummary[] }.
        return ["sessions": ctx.sessions.listSummaries()] as [String: Any]
    }

    registry.register("getSession", capabilities: [.sessionsRead]) { params, ctx in
        ctx.sessions.ensureConformanceSeed(enabled: ctx.conformanceSeedEnabled)
        let sessionId = try requireSessionId(params)
        guard let session = ctx.sessions.get(sessionId) else {
            throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
        }
        // GetSessionResult = { session: SessionRecord, run: CaptureRunManifest | null }.
        let run = ctx.sessions.getRun(sessionId)
        return ["session": session.json, "run": run?.json ?? NSNull()] as [String: Any]
    }

    registry.register("getRun", capabilities: [.sessionsRead]) { params, ctx in
        ctx.sessions.ensureConformanceSeed(enabled: ctx.conformanceSeedEnabled)
        let sessionId = try requireSessionId(params)
        guard let run = ctx.sessions.getRun(sessionId) else {
            throw DaemonApiError(.notFound, "Run for session \(sessionId) not found", status: 404)
        }
        // GetRunResult = { run: CaptureRunManifest }.
        return ["run": run.json] as [String: Any]
    }

    registry.register("closeSession", capabilities: [.sessionsWrite]) { params, ctx in
        let sessionId = try requireSessionId(params)
        // Driver teardown FIRST (mirrors handleSession's 'close' action
        // ordering: `driver.close()` + registry removal happens before the
        // session record itself is closed). `driver.close()` is the
        // session-scoped teardown (never throws, per the frozen Driver
        // contract) — NOT `disconnect()`, which would tear down shared
        // underlying infra (e.g. NativeDriver's shared bridge process) other
        // sessions may still be using.
        if let driver = ctx.driverRegistry.remove(sessionId) {
            driver.close()
        }
        // Mirrors SessionManager.close: idempotent, no-op if already absent —
        // never throws not_found (matches handleSession's 'close' action).
        ctx.sessions.close(sessionId)
        // CloseSessionResult = { success: true }.
        return ["success": true] as [String: Any]
    }

    registry.register("closeAllSessions", capabilities: [.sessionsWrite]) { _, ctx in
        // Mirrors handleSession's 'close_all' action: tear down every
        // currently-registered driver before closing the sessions
        // themselves. DriverRegistry has no enumeration method (frozen,
        // W0/DriverProtocol.swift) — so this walks SessionStore's own known
        // ids (which this file already owns) and asks the registry to
        // remove-if-present for each, rather than needing DriverRegistry to
        // expose its internal table.
        for summary in ctx.sessions.listSummaries() {
            guard let sessionId = summary["id"] as? String else { continue }
            if let driver = ctx.driverRegistry.remove(sessionId) {
                driver.close()
            }
        }
        ctx.sessions.closeAll()
        // CloseAllSessionsResult = { success: true }.
        return ["success": true] as [String: Any]
    }

    registry.register("recordLlmUsage", capabilities: [.sessionsWrite]) { params, ctx in
        let dict = paramsDict(params)
        guard let sessionId = dict["sessionId"] as? String, !sessionId.isEmpty else {
            throw DaemonApiError(.badRequest, "sessionId is required", status: 400)
        }
        guard let usage = dict["usage"] else {
            throw DaemonApiError(.badRequest, "usage is required", status: 400)
        }
        let (path, entries) = ctx.sessions.recordLlmUsage(sessionId: sessionId, usage: usage)
        // RecordLlmUsageResult = { success: true, path: string, entries: number }.
        return ["success": true, "path": path, "entries": entries] as [String: Any]
    }
}

// ─── Param helpers ─────────────────────────────────────────────────────────

private func paramsDict(_ params: Any?) -> [String: Any] {
    (params as? [String: Any]) ?? [:]
}

private func requireSessionId(_ params: Any?) throws -> String {
    let dict = paramsDict(params)
    guard let sessionId = dict["sessionId"] as? String, !sessionId.isEmpty else {
        throw DaemonApiError(.badRequest, "sessionId is required", status: 400)
    }
    return sessionId
}
