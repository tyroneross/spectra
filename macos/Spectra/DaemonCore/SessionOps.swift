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
        // Mirrors SessionManager.close: idempotent, no-op if already absent —
        // never throws not_found (matches handleSession's 'close' action).
        ctx.sessions.close(sessionId)
        // CloseSessionResult = { success: true }.
        return ["success": true] as [String: Any]
    }

    registry.register("closeAllSessions", capabilities: [.sessionsWrite]) { _, ctx in
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
