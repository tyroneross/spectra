// macos/Spectra/DaemonCore/SessionStore.swift
//
// M3.G1 — session state store. Backs listSessions / getSession / getRun /
// closeSession / closeAllSessions / recordLlmUsage. Thread-safe (the socket
// server handles connections concurrently).
//
// Mirrors src/core/types.ts (Session/Step/CaptureRun*) and
// src/contract/core-api.ts (SessionRecord/SessionSummary/CaptureRunManifest)
// field-for-field so JSON produced here validates against
// src/contract/contract.spec.json via tests/conformance/lib/result-validator.ts.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

// ─── Wire-shape value types (mirror src/core/types.ts) ────────────────────────

/// Mirrors core-api.ts `Action`: { type, elementId, value? }.
struct SpectraAction {
    var type: String // ActionType: click|type|clear|select|scroll|hover|focus
    var elementId: String
    var value: String?

    var json: [String: Any] {
        var d: [String: Any] = ["type": type, "elementId": elementId]
        if let value { d["value"] = value }
        return d
    }
}

/// Mirrors core-api.ts `DriverTarget`.
struct SpectraDriverTarget {
    var url: String?
    var appName: String?
    var deviceId: String?
    var command: String?

    var json: [String: Any] {
        var d: [String: Any] = [:]
        if let url { d["url"] = url }
        if let appName { d["appName"] = appName }
        if let deviceId { d["deviceId"] = deviceId }
        if let command { d["command"] = command }
        return d
    }
}

/// Mirrors core-api.ts `SessionStep` (nested under SessionRecord.steps).
struct SpectraSessionStep {
    var index: Int
    var action: SpectraAction
    var snapshotBefore: String
    var snapshotAfter: String
    var screenshotPath: String
    var success: Bool
    var error: String?
    var timestamp: Int // ms epoch
    var duration: Int
    var intent: String?
    var decisionId: String?

    var json: [String: Any] {
        var d: [String: Any] = [
            "index": index,
            "action": action.json,
            "snapshotBefore": snapshotBefore,
            "snapshotAfter": snapshotAfter,
            "screenshotPath": screenshotPath,
            "success": success,
            "timestamp": timestamp,
            "duration": duration,
        ]
        if let error { d["error"] = error }
        if let intent { d["intent"] = intent }
        if let decisionId { d["decisionId"] = decisionId }
        return d
    }
}

/// Mirrors core-api.ts `CaptureRunRecording`.
struct SpectraCaptureRunRecording {
    var state: String = "idle" // CaptureRunRecordingState
    var recordingId: String?
    var preset: String?
    var startedAt: Int?
    var stoppedAt: Int?
    var rawPath: String?
    var path: String?
    var durationMs: Int?
    var sizeBytes: Int?
    var codec: String?
    var fps: Int?
    var width: Int?
    var height: Int?
    var bitrate: String?
    var droppedFrames: Int?
    var error: String?
    var source: String?
    var sourceVerified: Bool?
    var cursorTelemetryPath: String?

    var json: [String: Any] {
        var d: [String: Any] = ["state": state]
        if let recordingId { d["recordingId"] = recordingId }
        if let preset { d["preset"] = preset }
        if let startedAt { d["startedAt"] = startedAt }
        if let stoppedAt { d["stoppedAt"] = stoppedAt }
        if let rawPath { d["rawPath"] = rawPath }
        if let path { d["path"] = path }
        if let durationMs { d["durationMs"] = durationMs }
        if let sizeBytes { d["sizeBytes"] = sizeBytes }
        if let codec { d["codec"] = codec }
        if let fps { d["fps"] = fps }
        if let width { d["width"] = width }
        if let height { d["height"] = height }
        if let bitrate { d["bitrate"] = bitrate }
        if let droppedFrames { d["droppedFrames"] = droppedFrames }
        if let error { d["error"] = error }
        if let source { d["source"] = source }
        if let sourceVerified { d["sourceVerified"] = sourceVerified }
        if let cursorTelemetryPath { d["cursorTelemetryPath"] = cursorTelemetryPath }
        return d
    }
}

/// Mirrors core-api.ts `CaptureRunAction` (the run-manifest's action log entry).
struct SpectraCaptureRunAction {
    var stepIndex: Int
    var timestamp: Int
    var tool: String?
    var plannerSource: String?
    var intent: String?
    var action: SpectraAction
    var snapshotBefore: String
    var snapshotAfter: String
    var screenshotPath: String
    var success: Bool
    var error: String?
    var duration: Int
    var decisionId: String?

    var json: [String: Any] {
        var d: [String: Any] = [
            "stepIndex": stepIndex,
            "timestamp": timestamp,
            "action": action.json,
            "snapshotBefore": snapshotBefore,
            "snapshotAfter": snapshotAfter,
            "screenshotPath": screenshotPath,
            "success": success,
            "duration": duration,
        ]
        if let tool { d["tool"] = tool }
        if let plannerSource { d["plannerSource"] = plannerSource }
        if let intent { d["intent"] = intent }
        if let error { d["error"] = error }
        if let decisionId { d["decisionId"] = decisionId }
        return d
    }
}

/// Mirrors core-api.ts `CaptureRunCandidate`.
struct SpectraCaptureRunCandidate {
    var id: String
    var role: String
    var label: String
    var confidence: Double?

    var json: [String: Any] {
        var d: [String: Any] = ["id": id, "role": role, "label": label]
        if let confidence { d["confidence"] = confidence }
        return d
    }
}

/// Mirrors core-api.ts `CaptureRunDecision`.
struct SpectraCaptureRunDecision {
    var id: String
    var timestamp: Int
    var tool: String
    var plannerSource: String
    var intent: String?
    var mode: String?
    var confidence: Double?
    var outcome: String // CaptureRunDecisionOutcome
    var selected: SpectraCaptureRunCandidate?
    var candidates: [SpectraCaptureRunCandidate]?
    var action: SpectraAction?
    var actionReason: String?
    var visionFallback: Bool?
    var stepIndex: Int?
    var error: String?

    var json: [String: Any] {
        var d: [String: Any] = [
            "id": id,
            "timestamp": timestamp,
            "tool": tool,
            "plannerSource": plannerSource,
            "outcome": outcome,
        ]
        if let intent { d["intent"] = intent }
        if let mode { d["mode"] = mode }
        if let confidence { d["confidence"] = confidence }
        if let selected { d["selected"] = selected.json }
        if let candidates { d["candidates"] = candidates.map { $0.json } }
        if let action { d["action"] = action.json }
        if let actionReason { d["actionReason"] = actionReason }
        if let visionFallback { d["visionFallback"] = visionFallback }
        if let stepIndex { d["stepIndex"] = stepIndex }
        if let error { d["error"] = error }
        return d
    }
}

/// Mirrors core-api.ts `CaptureRunArtifact`.
struct SpectraCaptureRunArtifact {
    var id: String
    var type: String // 'screenshot' | 'video' | 'raw-video' | 'snapshot' | 'other'
    var path: String
    var format: String?
    var label: String?
    var createdAt: Int
    var stepIndex: Int?
    var sizeBytes: Int?
    var metadata: [String: Any]?

    var json: [String: Any] {
        var d: [String: Any] = ["id": id, "type": type, "path": path, "createdAt": createdAt]
        if let format { d["format"] = format }
        if let label { d["label"] = label }
        if let stepIndex { d["stepIndex"] = stepIndex }
        if let sizeBytes { d["sizeBytes"] = sizeBytes }
        if let metadata { d["metadata"] = metadata }
        return d
    }
}

/// Mirrors core-api.ts `CaptureRunEvent` (wire field name `CaptureRunEventRecord`).
struct SpectraCaptureRunEvent {
    var id: String
    var timestamp: Int
    var type: String
    var summary: String
    var data: [String: Any]?

    var json: [String: Any] {
        var d: [String: Any] = ["id": id, "timestamp": timestamp, "type": type, "summary": summary]
        if let data { d["data"] = data }
        return d
    }
}

/// Mirrors core-api.ts `CaptureRunManifest` (the `getRun`/`getSession.run` shape).
final class SpectraCaptureRun {
    let schemaVersion = 1
    var runId: String
    var sessionId: String
    var name: String
    var platform: String
    var target: SpectraDriverTarget
    var plannerSource = "host-agent" // CaptureRunPlannerSource
    var plannerNote: String?
    var status = "active" // CaptureRunStatus
    var recording = SpectraCaptureRunRecording()
    var screenshotsCount = 0
    var videosCount = 0
    var errorsCount = 0
    var decisions: [SpectraCaptureRunDecision] = []
    var actions: [SpectraCaptureRunAction] = []
    var artifacts: [SpectraCaptureRunArtifact] = []
    var events: [SpectraCaptureRunEvent] = []
    var createdAt: Int
    var updatedAt: Int
    var closedAt: Int?

    init(runId: String, sessionId: String, name: String, platform: String, target: SpectraDriverTarget, now: Int) {
        self.runId = runId
        self.sessionId = sessionId
        self.name = name
        self.platform = platform
        self.target = target
        self.createdAt = now
        self.updatedAt = now
    }

    var json: [String: Any] {
        var planner: [String: Any] = ["source": plannerSource]
        if let plannerNote { planner["note"] = plannerNote }
        var d: [String: Any] = [
            "schemaVersion": schemaVersion,
            "runId": runId,
            "sessionId": sessionId,
            "name": name,
            "platform": platform,
            "target": target.json,
            "planner": planner,
            "status": status,
            "recording": recording.json,
            "stats": [
                "steps": actions.count,
                "screenshots": screenshotsCount,
                "videos": videosCount,
                "errors": errorsCount,
            ] as [String: Any],
            "decisions": decisions.map { $0.json },
            "actions": actions.map { $0.json },
            "artifacts": artifacts.map { $0.json },
            "events": events.map { $0.json },
            "createdAt": createdAt,
            "updatedAt": updatedAt,
        ]
        if let closedAt { d["closedAt"] = closedAt }
        return d
    }
}

/// Mirrors core-api.ts `SessionRecord` (the `getSession.session` shape).
final class SpectraSessionRecord {
    let id: String
    var name: String
    var platform: String // Platform: web|macos|ios|watchos|terminal
    var target: SpectraDriverTarget
    var steps: [SpectraSessionStep] = []
    var createdAt: Int
    var updatedAt: Int
    var closedAt: Int?
    var storageRoot: String?

    init(id: String, name: String, platform: String, target: SpectraDriverTarget, now: Int) {
        self.id = id
        self.name = name
        self.platform = platform
        self.target = target
        self.createdAt = now
        self.updatedAt = now
    }

    var json: [String: Any] {
        var d: [String: Any] = [
            "id": id,
            "name": name,
            "platform": platform,
            "target": target.json,
            "steps": steps.map { $0.json },
            "createdAt": createdAt,
            "updatedAt": updatedAt,
        ]
        if let closedAt { d["closedAt"] = closedAt }
        if let storageRoot { d["storageRoot"] = storageRoot }
        return d
    }
}

/// Mirrors core-api.ts `SessionSummary` (the `listSessions` element shape).
private func sessionSummaryJSON(_ session: SpectraSessionRecord, recordingState: String) -> [String: Any] {
    let iso = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: Double(session.createdAt) / 1000))
    return [
        "id": session.id,
        "name": session.name,
        "platform": session.platform,
        "steps": session.steps.count,
        "recordingState": recordingState,
        "createdAt": iso,
    ]
}

// ─── Store ─────────────────────────────────────────────────────────────────

/// Fixed, well-known id for the conformance-seed session. When
/// SPECTRA_CONFORMANCE_SEED=1 the store lazily seeds exactly one session
/// under this id, pre-populated with 2 conformant recorded steps + a matching
/// run — the external-daemon analog of the in-process M2B fixture (a
/// `readonly` session seeded with 2 `act` steps: a bare click, then a
/// click-with-value — see tests/conformance/lib/fixture-context.ts
/// seedExternalSessions). This lets getSession/getRun reach a populated,
/// spec-conformant nested shape without a live createSession/act call.
let conformanceSeedSessionId = "conformance-seed"

final class SessionStore: @unchecked Sendable, SessionPresenceQuerying {
    private let lock = NSLock()
    private var sessions: [String: SpectraSessionRecord] = [:]
    private var runs: [String: SpectraCaptureRun] = [:]
    private var seeded = false

    func withLock<T>(_ body: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return body()
    }

    /// Throwing counterpart to `withLock` — used by the G2 write surface
    /// below, whose `DaemonApiError.notFound` throw needs to happen while the
    /// lock is held (the not-found check and the mutation are one atomic
    /// section, matching every other read-modify-write in this store).
    private func withLockThrows<T>(_ body: () throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }
        return try body()
    }

    /// 8-char id generator matching the shape (not the byte content) of TS's
    /// `randomUUID().slice(0, 8)` — used for decision/artifact/event ids
    /// generated store-side, same convention as G1's recordLlmUsage.
    private func shortId() -> String { String(UUID().uuidString.prefix(8)).lowercased() }

    // ─── Conformance seed (lazy, idempotent) ──────────────────────────────

    /// Seeds the deterministic `conformance-seed` session on first call when
    /// `enabled` is true. Safe to call on every op entry — no-ops after the
    /// first successful seed or when the flag is off.
    func ensureConformanceSeed(enabled: Bool) {
        guard enabled else { return }
        withLock {
            guard !seeded else { return }
            seeded = true
            seedConformanceSessionLocked()
        }
    }

    private func seedConformanceSessionLocked() {
        let id = conformanceSeedSessionId
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let target = SpectraDriverTarget(url: "http://127.0.0.1/conformance-fixture")
        let session = SpectraSessionRecord(id: id, name: "conformance-seed", platform: "web", target: target, now: now)
        let run = SpectraCaptureRun(runId: id, sessionId: id, name: session.name, platform: session.platform, target: target, now: now)
        run.plannerNote = "Seeded by SPECTRA_CONFORMANCE_SEED for external-daemon oracle verification."

        // 2 conformant steps mirroring the M2B fixture's readonly-session seed:
        // a bare click, then a click carrying a value — both against the same
        // fixed fake element id used by the in-process fixture (FAKE_ELEMENT_ID
        // = 'el-1' in tests/conformance/lib/fakes.ts).
        let seedActions: [SpectraAction] = [
            SpectraAction(type: "click", elementId: "el-1", value: nil),
            SpectraAction(type: "click", elementId: "el-1", value: "seed-value"),
        ]

        for (index, action) in seedActions.enumerated() {
            let pad = String(format: "%03d", index)
            let timestamp = now + index * 1000
            let snapshotBefore = "snapshots/step-\(pad)-before.json"
            let snapshotAfter = "snapshots/step-\(pad)-after.json"
            let screenshotPath = "step-\(pad).png"
            let decisionId = "seed-decision-\(pad)"

            session.steps.append(SpectraSessionStep(
                index: index,
                action: action,
                snapshotBefore: snapshotBefore,
                snapshotAfter: snapshotAfter,
                screenshotPath: screenshotPath,
                success: true,
                error: nil,
                timestamp: timestamp,
                duration: 50,
                intent: "seed step \(index)",
                decisionId: decisionId
            ))

            run.decisions.append(SpectraCaptureRunDecision(
                id: decisionId,
                timestamp: timestamp,
                tool: "act",
                plannerSource: "host-agent",
                intent: "seed step \(index)",
                mode: "algorithmic",
                confidence: 1.0,
                outcome: "auto-executed",
                selected: SpectraCaptureRunCandidate(id: action.elementId, role: "button", label: "Fixture Button", confidence: 1.0),
                candidates: nil,
                action: action,
                actionReason: "conformance seed",
                visionFallback: false,
                stepIndex: index,
                error: nil
            ))

            run.actions.append(SpectraCaptureRunAction(
                stepIndex: index,
                timestamp: timestamp,
                tool: "act",
                plannerSource: "host-agent",
                intent: "seed step \(index)",
                action: action,
                snapshotBefore: snapshotBefore,
                snapshotAfter: snapshotAfter,
                screenshotPath: screenshotPath,
                success: true,
                error: nil,
                duration: 50,
                decisionId: decisionId
            ))

            run.artifacts.append(SpectraCaptureRunArtifact(
                id: "seed-artifact-\(pad)",
                type: "screenshot",
                path: screenshotPath,
                format: "png",
                label: "seed step \(index)",
                createdAt: timestamp,
                stepIndex: index,
                sizeBytes: nil,
                metadata: nil
            ))

            run.events.append(SpectraCaptureRunEvent(
                id: "seed-event-\(pad)",
                timestamp: timestamp,
                type: "action.completed",
                summary: "success: \(action.type) \(action.elementId)",
                data: ["stepIndex": index, "decisionId": decisionId]
            ))
            run.screenshotsCount += 1
        }

        run.events.insert(SpectraCaptureRunEvent(
            id: "seed-event-created",
            timestamp: now,
            type: "session.created",
            summary: "session created: \(session.name)",
            data: nil
        ), at: 0)

        sessions[id] = session
        runs[id] = run
    }

    // ─── Reads ─────────────────────────────────────────────────────────────

    func get(_ sessionId: String) -> SpectraSessionRecord? {
        withLock { sessions[sessionId] }
    }

    func getRun(_ sessionId: String) -> SpectraCaptureRun? {
        withLock { runs[sessionId] }
    }

    /// listSessions result shape: SessionSummary[] (id/name/platform/steps/recordingState/createdAt).
    func listSummaries() -> [[String: Any]] {
        withLock {
            sessions.values
                .sorted { $0.createdAt < $1.createdAt }
                .map { session in
                    let recordingState = runs[session.id]?.recording.state ?? "idle"
                    return sessionSummaryJSON(session, recordingState: recordingState)
                }
        }
    }

    // ─── SessionPresenceQuerying (routing-read addendum #1, DriverProtocol.swift §4) ──
    // S6's Router reads this on EVERY affinity-routed request to decide
    // native-vs-tunnel (store-presence IS the routing signal, ADR-04 rev 2).
    // O(1), no side effects — MUST NOT call ensureConformanceSeed (a routing
    // probe must stay idempotent; it never seeds conformance state).

    func contains(_ sessionId: String) -> Bool {
        withLock { sessions[sessionId] != nil }
    }

    // ─── Writes ────────────────────────────────────────────────────────────

    /// Creates + inserts a new session record (and its companion
    /// CaptureRunManifest), mirroring `SessionManager.create` (src/core/
    /// session.ts:59-92): storageRoot anchored under `repoPath` when supplied
    /// (C2.6 — launchd-spawned daemons still write into `<repo>/.spectra/`),
    /// else the same SPECTRA_HOME/HOME-derived fallback `sessionDir(_:)` uses
    /// for an untracked id, so a freshly created session's directory is
    /// never inconsistent with what a later `sessionDir(sessionId)` call
    /// would independently derive. Best-effort `snapshots/` directory
    /// creation (mirrors the TS `mkdir` call) — a filesystem hiccup here
    /// degrades gracefully rather than failing the whole createSession
    /// response (this store's established graceful-degradation posture).
    ///
    /// NOT part of the W0 frozen write surface (that's addStep/addDecision/
    /// addArtifact/setRecordingStatus, consumed by S3/S4) — this is S1's own
    /// internal construction helper for ConnectOps.swift's createSession,
    /// scoped to this file/that file only.
    @discardableResult
    func create(
        id: String,
        name: String,
        platform: String,
        target: SpectraDriverTarget,
        repoPath: String?,
        now: Int
    ) -> SpectraSessionRecord {
        withLock {
            let root = repoPath.map { getStoragePath(cwd: $0) } ?? defaultSpectraRootLocked()
            let storageRoot = (root as NSString).appendingPathComponent("sessions/\(id)")

            let session = SpectraSessionRecord(id: id, name: name, platform: platform, target: target, now: now)
            session.storageRoot = storageRoot

            let run = SpectraCaptureRun(runId: id, sessionId: id, name: name, platform: platform, target: target, now: now)
            run.events.append(SpectraCaptureRunEvent(
                id: "event-\(shortId())",
                timestamp: now,
                type: "session.created",
                summary: "session created: \(name)",
                data: nil
            ))

            sessions[id] = session
            runs[id] = run

            try? FileManager.default.createDirectory(
                atPath: (storageRoot as NSString).appendingPathComponent("snapshots"),
                withIntermediateDirectories: true
            )
            return session
        }
    }

    /// Appends `step` to the session (throws `.notFound` if `sessionId` is
    /// absent — mirrors SessionManager.addStep's `Session ${id} not found`),
    /// bumps `session.updatedAt`, and folds the step into the run manifest
    /// exactly like `SessionManager.addRunAction` does: one CaptureRunAction,
    /// one screenshot CaptureRunArtifact, one "action.completed" event, an
    /// errors-count bump on failure. The CALLER (S3/S4) is responsible for
    /// having already written the step's snapshot/screenshot bytes under
    /// `sessionDir(sessionId)` — this method only appends the already-built
    /// record, matching the frozen signature's shape (no file I/O here).
    func addStep(sessionId: String, step: SpectraSessionStep) throws {
        try withLockThrows {
            guard let session = sessions[sessionId] else {
                throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
            }
            session.steps.append(step)
            session.updatedAt = Int(Date().timeIntervalSince1970 * 1000)

            let run = ensureRunLocked(sessionId, session: session)
            // NOTE: SpectraSessionStep carries no tool/plannerSource fields
            // (unlike TS's addStep, which threads those through from its
            // caller's AddStepOptions) — the frozen addStep(sessionId:step:)
            // signature takes only the fully-built step, so the derived
            // CaptureRunAction's tool/plannerSource are left nil here
            // (both optional wire fields; graceful omission, not a mismatch).
            run.actions.append(SpectraCaptureRunAction(
                stepIndex: step.index,
                timestamp: step.timestamp,
                tool: nil,
                plannerSource: nil,
                intent: step.intent,
                action: step.action,
                snapshotBefore: step.snapshotBefore,
                snapshotAfter: step.snapshotAfter,
                screenshotPath: step.screenshotPath,
                success: step.success,
                error: step.error,
                duration: step.duration,
                decisionId: step.decisionId
            ))
            if !step.success { run.errorsCount += 1 }
            run.artifacts.append(SpectraCaptureRunArtifact(
                id: "artifact-\(shortId())",
                type: "screenshot",
                path: step.screenshotPath,
                format: "png",
                label: step.intent,
                createdAt: step.timestamp,
                stepIndex: step.index,
                sizeBytes: nil,
                metadata: nil
            ))
            run.screenshotsCount += 1
            var eventData: [String: Any] = ["stepIndex": step.index]
            if let decisionId = step.decisionId { eventData["decisionId"] = decisionId }
            run.events.append(SpectraCaptureRunEvent(
                id: "event-\(shortId())",
                timestamp: step.timestamp,
                type: "action.completed",
                summary: "\(step.success ? "success" : "failed"): \(step.action.type) \(step.action.elementId)",
                data: eventData
            ))
            bumpRunLocked(run)
        }
    }

    /// Appends `decision` to the session's run manifest (throws `.notFound`
    /// if `sessionId` is absent). Mirrors SessionManager.addDecision: one
    /// "decision.recorded" event, an errors-count bump on a `failed` outcome.
    /// The caller (S3) supplies the FULLY-BUILT decision (id + timestamp
    /// already set) per the frozen signature — unlike TS's addDecision,
    /// which generates those two fields itself from an Omit<...> options
    /// type; this store never mints a decision id/timestamp on the caller's
    /// behalf.
    func addDecision(sessionId: String, decision: SpectraCaptureRunDecision) throws {
        try withLockThrows {
            guard let session = sessions[sessionId] else {
                throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
            }
            let run = ensureRunLocked(sessionId, session: session)
            run.decisions.append(decision)
            let summary = decision.intent.map { "\(decision.outcome): \($0)" } ?? "\(decision.outcome): \(decision.tool)"
            run.events.append(SpectraCaptureRunEvent(
                id: "event-\(shortId())",
                timestamp: decision.timestamp,
                type: "decision.recorded",
                summary: summary,
                data: ["decisionId": decision.id, "outcome": decision.outcome]
            ))
            if decision.outcome == "failed" { run.errorsCount += 1 }
            bumpRunLocked(run)
        }
    }

    /// Appends `artifact` to the session's run manifest (throws `.notFound`
    /// if `sessionId` is absent). Mirrors SessionManager.addArtifact: bumps
    /// screenshotsCount/videosCount by `artifact.type`, appends an
    /// "artifact.added" event. Caller (S4) supplies the fully-built artifact
    /// (id + createdAt already set), same rationale as addDecision above.
    func addArtifact(sessionId: String, artifact: SpectraCaptureRunArtifact) throws {
        try withLockThrows {
            guard let session = sessions[sessionId] else {
                throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
            }
            let run = ensureRunLocked(sessionId, session: session)
            run.artifacts.append(artifact)
            if artifact.type == "screenshot" { run.screenshotsCount += 1 }
            if artifact.type == "video" { run.videosCount += 1 }
            run.events.append(SpectraCaptureRunEvent(
                id: "event-\(shortId())",
                timestamp: artifact.createdAt,
                type: "artifact.added",
                summary: "\(artifact.type): \(artifact.path)",
                data: ["artifactId": artifact.id, "path": artifact.path, "type": artifact.type]
            ))
            bumpRunLocked(run)
        }
    }

    /// Updates the session's recording status (throws `.notFound` if
    /// `sessionId` is absent), returning the UPDATED recording record —
    /// mirrors `core-impl.ts`'s `const recording = await
    /// this.ctx.sessions.setRecordingStatus(...)` call shape.
    ///
    /// MERGE SEMANTICS NOTE (flagged W0 ambiguity — see the returned build
    /// summary): TS's `setRecordingStatus` takes a `Partial<CaptureRunRecording>
    /// & Pick<'state'>` — only the fields the caller supplies are merged over
    /// the existing recording; everything else is left untouched. The frozen
    /// Swift signature instead takes a FULLY-POPULATED `SpectraCaptureRunRecording`
    /// (no `Partial<T>` equivalent exists for a Swift struct literal). A
    /// naive whole-struct replace would silently null out previously-set
    /// fields (e.g. `recordingId`/`path`) whenever a caller only means to
    /// flip `state`. This implementation instead does a field-by-field merge
    /// — every OPTIONAL field on `recording` that is non-nil overwrites the
    /// existing value; `nil` means "not supplied, leave as-is" (the closest
    /// Swift-native analog of TS's Partial-merge semantics); `state` (the one
    /// non-optional field) always overwrites, matching TS's `Pick<'state'>`
    /// required-field treatment.
    @discardableResult
    func setRecordingStatus(sessionId: String, recording: SpectraCaptureRunRecording) throws -> SpectraCaptureRunRecording {
        try withLockThrows {
            guard let session = sessions[sessionId] else {
                throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
            }
            let run = ensureRunLocked(sessionId, session: session)

            var merged = run.recording
            merged.state = recording.state
            if let v = recording.recordingId { merged.recordingId = v }
            if let v = recording.preset { merged.preset = v }
            if let v = recording.startedAt { merged.startedAt = v }
            if let v = recording.stoppedAt { merged.stoppedAt = v }
            if let v = recording.rawPath { merged.rawPath = v }
            if let v = recording.path { merged.path = v }
            if let v = recording.durationMs { merged.durationMs = v }
            if let v = recording.sizeBytes { merged.sizeBytes = v }
            if let v = recording.codec { merged.codec = v }
            if let v = recording.fps { merged.fps = v }
            if let v = recording.width { merged.width = v }
            if let v = recording.height { merged.height = v }
            if let v = recording.bitrate { merged.bitrate = v }
            if let v = recording.droppedFrames { merged.droppedFrames = v }
            if let v = recording.error { merged.error = v }
            if let v = recording.source { merged.source = v }
            if let v = recording.sourceVerified { merged.sourceVerified = v }
            if let v = recording.cursorTelemetryPath { merged.cursorTelemetryPath = v }
            run.recording = merged

            if merged.state == "failed" { run.errorsCount += 1 }
            run.events.append(SpectraCaptureRunEvent(
                id: "event-\(shortId())",
                timestamp: Int(Date().timeIntervalSince1970 * 1000),
                type: "recording.status",
                summary: "recording \(merged.state)",
                data: merged.json
            ))
            bumpRunLocked(run)
            return merged
        }
    }

    /// Caller must hold `lock`. Mirrors `SessionManager.ensureRun`: returns
    /// the existing run if present, else lazily creates one from the
    /// session's own createdAt (defensive parity fallback — in practice
    /// every session created via `create(...)` above already has a run).
    private func ensureRunLocked(_ sessionId: String, session: SpectraSessionRecord) -> SpectraCaptureRun {
        if let run = runs[sessionId] { return run }
        let run = SpectraCaptureRun(
            runId: session.id, sessionId: session.id, name: session.name,
            platform: session.platform, target: session.target, now: session.createdAt
        )
        run.events.append(SpectraCaptureRunEvent(
            id: "event-\(shortId())",
            timestamp: session.createdAt,
            type: "session.created",
            summary: "session created: \(session.name)",
            data: nil
        ))
        runs[sessionId] = run
        return run
    }

    /// Caller must hold `lock`. Mirrors `updateRun`'s `run.updatedAt =
    /// Date.now()` bump (the `stats.steps = actions.length` bump has no
    /// Swift-side counterpart to touch — `SpectraCaptureRun.json`'s `stats`
    /// block already computes `actions.count` live on every read).
    private func bumpRunLocked(_ run: SpectraCaptureRun) {
        run.updatedAt = Int(Date().timeIntervalSince1970 * 1000)
    }

    /// Idempotent — mirrors SessionManager.close: a no-op if the session is
    /// already absent, never throws not_found.
    func close(_ sessionId: String) {
        withLock {
            sessions.removeValue(forKey: sessionId)
            runs.removeValue(forKey: sessionId)
        }
    }

    func closeAll() {
        withLock {
            sessions.removeAll()
            runs.removeAll()
        }
    }

    /// Appends one entry to `<sessionStorageDir>/llm-usage.json` (creating the
    /// array file if absent) and returns (path, total entry count) — mirrors
    /// src/mcp/tools/session.ts's `record_llm_usage` action. Best-effort file
    /// I/O (never throws): a filesystem hiccup degrades to entries=0 rather
    /// than failing the whole daemon call, matching this store's other
    /// graceful-degradation ops.
    func recordLlmUsage(sessionId: String, usage: Any?) -> (path: String, entries: Int) {
        withLock {
            let dir = sessionDirLocked(sessionId)
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            let path = (dir as NSString).appendingPathComponent("llm-usage.json")

            var existing: [[String: Any]] = []
            if let data = FileManager.default.contents(atPath: path),
               let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] {
                existing = arr
            }

            var entry: [String: Any] = ["ts": Int(Date().timeIntervalSince1970 * 1000)]
            if let usageDict = usage as? [String: Any] {
                for (key, value) in usageDict { entry[key] = value }
            } else if let usage {
                entry["usage"] = usage
            }
            existing.append(entry)

            if let data = try? JSONSerialization.data(withJSONObject: existing, options: [.prettyPrinted]) {
                try? data.write(to: URL(fileURLWithPath: path))
            }
            return (path, existing.count)
        }
    }

    /// PUBLIC (W0 §4 — was PRIVATE `sessionDirLocked`; S3/S4 need this to
    /// know where to write step/artifact bytes BEFORE calling addStep/
    /// addArtifact). Same behavior as before the rename/exposure — only the
    /// access level changed: prefers the session's own storageRoot when
    /// known, else falls back to a deterministic `<spectraRoot>/sessions/<id>`
    /// path (works even for an id with no tracked session, matching the TS
    /// fallback). Non-throwing.
    func sessionDir(_ sessionId: String) -> String {
        withLock { sessionDirLocked(sessionId) }
    }

    /// Caller must hold `lock`. Kept as the internal single-source-of-truth
    /// so `recordLlmUsage` (which already holds the lock) and the public
    /// `sessionDir(_:)` above never diverge.
    private func sessionDirLocked(_ sessionId: String) -> String {
        if let storageRoot = sessions[sessionId]?.storageRoot { return storageRoot }
        return (defaultSpectraRootLocked() as NSString).appendingPathComponent("sessions/\(sessionId)")
    }

    /// Caller must hold `lock` (no shared mutable state read, but kept
    /// consistent with its two call sites, both already inside `withLock`).
    /// Honor SPECTRA_HOME first (storage-isolation contract — matches
    /// LibraryStore.resolveStorageRoot and the oracle harness, which sets
    /// SPECTRA_HOME to an isolated tmp dir). HOME-only would leak
    /// llm-usage/session writes to the real ~/.spectra under a
    /// SPECTRA_HOME-only isolation.
    ///
    /// M3.G2 S1 fix (Advisor ruling, Item 2 real half): SPECTRA_HOME is a
    /// HOME substitute, not an already-resolved `.spectra` root — the G1/G2
    /// harnesses set SPECTRA_HOME to the SAME raw temp dir as HOME
    /// (verify-g2-suite.ts's `bootEnvFor`), so it gets the identical
    /// `.spectra` append as the HOME branch immediately below (mirrors
    /// `resolveStorageRoot()` in StoragePath.swift, fixed alongside this).
    /// Previously this branch returned SPECTRA_HOME bare, dropping the
    /// `.spectra` segment and writing sessions to `<home>/sessions/<id>/…`
    /// instead of TS's `<home>/.spectra/sessions/<id>/…`
    /// (g2-t21-masks.json discover.detail).
    private func defaultSpectraRootLocked() -> String {
        let env = ProcessInfo.processInfo.environment
        return env["SPECTRA_HOME"].flatMap { $0.isEmpty ? nil : ($0 as NSString).appendingPathComponent(".spectra") }
            ?? (env["HOME"].map { ($0 as NSString).appendingPathComponent(".spectra") })
            ?? (NSHomeDirectory() as NSString).appendingPathComponent(".spectra")
    }
}
