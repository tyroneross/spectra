// macos/Spectra/DaemonCore/StepOps.swift
//
// M3.G2 (S3, step-intelligence-engine) — `step`, `llmStep`, `walkthrough`,
// `observe`, and the `registerStepOps` hook that bundles ALL SIX of S3's ops
// (step/llmStep/walkthrough/observe/analyze/discover — the exact set W0's
// DriverProtocol.swift §5 freezes under one `registerStepOps` name).
//
// NO LLM ANYWHERE IN THIS FILE:
//   - `step` resolves intent -> element via Resolve.swift's deterministic
//     text/spatial matcher (Resolve.swift/resolve.ts port), then picks an
//     action via Actions.swift (actions.ts port). High confidence + no
//     candidates -> auto-execute; otherwise the candidates are returned to
//     the CALLER (the host agent/Claude, which holds the model) to pick.
//   - `llmStep` executes a CLIENT-BUILT `ActionPlan[]` (the Swift menu-bar
//     app holds the user's Anthropic key and builds the plan from a single
//     LLM turn OUTSIDE the daemon) — this handler just resolves each
//     elementId against the current driver and calls `.act()`. The daemon
//     never sees, stores, or calls out to an LLM key.
//   - `walkthrough` loops `handleStep` N times; still zero LLM calls.
//   - `observe`/`analyze`/`discover` are snapshot + deterministic heuristics
//     (Intelligence.swift) only.
//
// Every op resolves `ctx.driverRegistry.get(sessionId)` and calls ONLY the
// frozen `Driver` protocol (.snapshot()/.act()/.screenshot()) — headless-
// verifiable end-to-end against S1's FakeDriver, no real hardware needed.
//
// Cross-agent dependency: every op below calls `SnapshotSerialize.
// serializeSnapshot(_:)` / `SnapshotSerialize.serializeElement(_:)` — S2's
// SnapshotSerialize.swift (parity with src/core/serialize.ts), landed as:
//   enum SnapshotSerialize {
//       static func serializeSnapshot(_ snapshot: DriverSnapshot) -> String
//       static func serializeElement(_ element: DriverElement) -> String
//   }
// Confirmed against S2's actual SnapshotSerialize.swift (not this file's
// owned symbol) via a combined `swiftc -typecheck` self-check.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - step
// ═══════════════════════════════════════════════════════════════════════════

/// Mirrors step.ts `handleStep`.
func handleStep(sessionId: String, intent: String, ctx: DaemonContext) throws -> [String: Any] {
    guard let driver = ctx.driverRegistry.get(sessionId) else {
        throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
    }

    let snap = try driver.snapshot()
    let resolved = resolve(intent: intent, elements: snap.elements, mode: .claude)

    // High confidence, single element (no disambiguation candidates) -> auto-execute.
    if resolved.confidence > 0.9, resolved.candidates == nil, let element = resolved.element {
        let selected = selectActionForElement(element, options: ActionSelectionOptions(intent: intent, purpose: .step))

        guard let selected else {
            let errorMessage = "No supported action found for \(SnapshotSerialize.serializeElement(element))"
            try? ctx.sessions.addDecision(sessionId: sessionId, decision: SpectraCaptureRunDecision(
                id: UUID().uuidString, timestamp: nowMs(), tool: "spectra_step", plannerSource: "host-agent",
                intent: intent, mode: "claude", confidence: resolved.confidence, outcome: "failed",
                selected: SpectraCaptureRunCandidate(id: element.id, role: element.role, label: element.label, confidence: nil),
                candidates: nil, action: nil, actionReason: nil, visionFallback: nil, stepIndex: nil,
                error: errorMessage
            ))
            return [
                "snapshot": SnapshotSerialize.serializeSnapshot(snap),
                "candidates": [["id": element.id, "role": element.role, "label": element.label]],
                "error": errorMessage,
            ]
        }

        let decisionId = UUID().uuidString
        try? ctx.sessions.addDecision(sessionId: sessionId, decision: SpectraCaptureRunDecision(
            id: decisionId, timestamp: nowMs(), tool: "spectra_step", plannerSource: "host-agent",
            intent: intent, mode: "claude", confidence: resolved.confidence, outcome: "auto-executed",
            selected: SpectraCaptureRunCandidate(id: element.id, role: element.role, label: element.label, confidence: nil),
            candidates: nil,
            action: SpectraAction(type: selected.action.rawValue, elementId: element.id, value: selected.value),
            actionReason: selected.reason, visionFallback: nil, stepIndex: nil, error: nil
        ))

        let startMs = Date().timeIntervalSince1970 * 1000
        let actResult = try driver.act(elementId: element.id, action: selected.action, value: selected.value)
        let durationMs = Int(Date().timeIntervalSince1970 * 1000 - startMs)
        let screenshot = try driver.screenshot()
        let stepIndex = ctx.sessions.get(sessionId)?.steps.count ?? 0
        let screenshotPath = writeStepScreenshot(sessionId: sessionId, index: stepIndex, data: screenshot, ctx: ctx)

        try? ctx.sessions.addStep(sessionId: sessionId, step: SpectraSessionStep(
            index: stepIndex,
            action: SpectraAction(type: selected.action.rawValue, elementId: element.id, value: selected.value),
            snapshotBefore: SnapshotSerialize.serializeSnapshot(snap),
            snapshotAfter: SnapshotSerialize.serializeSnapshot(actResult.snapshot),
            screenshotPath: screenshotPath,
            success: actResult.success,
            error: actResult.error,
            timestamp: Int(startMs),
            duration: durationMs,
            intent: intent,
            decisionId: decisionId
        ))

        return [
            "snapshot": SnapshotSerialize.serializeSnapshot(actResult.snapshot),
            "autoExecuted": true,
            "action": "\(selected.action.rawValue) on \(SnapshotSerialize.serializeElement(element))",
            "actionReason": selected.reason,
        ]
    }

    // Low confidence or multiple candidates -> return for the host agent to pick.
    let candidateElements: [DriverElement] = resolved.candidates ?? (resolved.element.map { [$0] } ?? [])
    let candidatesJSON = candidateElements.map { ["id": $0.id, "role": $0.role, "label": $0.label] }

    try? ctx.sessions.addDecision(sessionId: sessionId, decision: SpectraCaptureRunDecision(
        id: UUID().uuidString, timestamp: nowMs(), tool: "spectra_step", plannerSource: "host-agent",
        intent: intent, mode: "claude", confidence: resolved.confidence, outcome: "needs-host-decision",
        selected: resolved.element.map { SpectraCaptureRunCandidate(id: $0.id, role: $0.role, label: $0.label, confidence: nil) },
        candidates: candidateElements.map { SpectraCaptureRunCandidate(id: $0.id, role: $0.role, label: $0.label, confidence: nil) },
        action: nil, actionReason: nil, visionFallback: resolved.visionFallback, stepIndex: nil, error: nil
    ))

    var result: [String: Any] = [
        "snapshot": SnapshotSerialize.serializeSnapshot(snap),
        "candidates": candidatesJSON,
    ]

    // Vision fallback: include a screenshot so the host agent can visually
    // identify the target (screenshot mode only — no LLM call here either;
    // the CALLER decides whether/how to use it).
    if resolved.visionFallback == true {
        result["visionFallback"] = true
        let buf = try driver.screenshot()
        result["screenshot"] = buf.base64EncodedString()
    }

    return result
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - llmStep
// ═══════════════════════════════════════════════════════════════════════════

/// One step of a client-built plan. Mirrors llm-step.ts `ActionPlanStep`.
struct LlmStepActionInput {
    var type: DriverActionType
    var elementId: String
    var value: String?
    var intent: String?
    var waitAfterMs: Double?
}

/// Mirrors llm-step.ts `handleLlmStep`. Executes `actions` IN ORDER against
/// the driver — no planning, no LLM call, no re-resolution: `elementId` is
/// used exactly as supplied (the client already resolved it against its own
/// most-recent snapshot; a stale/unknown id is handled by the frozen
/// `Driver.act` contract itself — success:false + fresh snapshot, never a
/// crash here).
func handleLlmStep(
    sessionId: String, actions: [LlmStepActionInput], continueOnError: Bool, ctx: DaemonContext
) throws -> [String: Any] {
    guard let driver = ctx.driverRegistry.get(sessionId) else {
        throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
    }
    let sessionExists = ctx.sessions.get(sessionId) != nil

    var results: [[String: Any]] = []
    var lastSnapshotSerialized: String?
    var overallSuccess = true

    for (i, step) in actions.enumerated() {
        let startedAtMs = Date().timeIntervalSince1970 * 1000

        let snapshotBefore: DriverSnapshot
        do {
            snapshotBefore = try driver.snapshot()
        } catch {
            results.append(llmStepResultEntry(
                index: i, step: step, success: false,
                error: "snapshot before step failed: \(error.localizedDescription)", startedAtMs: startedAtMs
            ))
            overallSuccess = false
            if !continueOnError { break } else { continue }
        }

        let actResult: DriverActResult
        do {
            actResult = try driver.act(elementId: step.elementId, action: step.type, value: step.value)
        } catch {
            results.append(llmStepResultEntry(
                index: i, step: step, success: false, error: error.localizedDescription, startedAtMs: startedAtMs
            ))
            overallSuccess = false
            if !continueOnError { break } else { continue }
        }

        if let waitMs = step.waitAfterMs, waitMs > 0 {
            Thread.sleep(forTimeInterval: waitMs / 1000.0)
        }

        // Persist as a session step (best-effort — a persistence failure must
        // never fail the action itself, mirrors llm-step.ts's empty catch).
        if sessionExists, actResult.success {
            let selectedElement = snapshotBefore.elements.first { $0.id == step.elementId }
            let decisionId = UUID().uuidString
            let stepIndex = ctx.sessions.get(sessionId)?.steps.count ?? i
            do {
                try ctx.sessions.addDecision(sessionId: sessionId, decision: SpectraCaptureRunDecision(
                    id: decisionId, timestamp: Int(startedAtMs), tool: "spectra_llm_step",
                    plannerSource: "standalone-fallback", intent: step.intent, mode: nil, confidence: nil,
                    outcome: "planned",
                    selected: SpectraCaptureRunCandidate(
                        id: step.elementId, role: selectedElement?.role ?? "unknown",
                        label: selectedElement?.label ?? step.elementId, confidence: nil
                    ),
                    candidates: nil,
                    action: SpectraAction(type: step.type.rawValue, elementId: step.elementId, value: step.value),
                    actionReason: "Client-side planner supplied an explicit element action.",
                    visionFallback: nil, stepIndex: nil, error: nil
                ))
                let screenshotData = try driver.screenshot()
                let screenshotPath = writeStepScreenshot(sessionId: sessionId, index: stepIndex, data: screenshotData, ctx: ctx)
                try ctx.sessions.addStep(sessionId: sessionId, step: SpectraSessionStep(
                    index: stepIndex,
                    action: SpectraAction(type: step.type.rawValue, elementId: step.elementId, value: step.value),
                    snapshotBefore: SnapshotSerialize.serializeSnapshot(snapshotBefore),
                    snapshotAfter: SnapshotSerialize.serializeSnapshot(actResult.snapshot),
                    screenshotPath: screenshotPath,
                    success: actResult.success, error: actResult.error,
                    timestamp: Int(startedAtMs), duration: Int(Date().timeIntervalSince1970 * 1000 - startedAtMs),
                    intent: step.intent, decisionId: decisionId
                ))
            } catch {
                // Persistence failures shouldn't fail the action.
            }
        }

        lastSnapshotSerialized = SnapshotSerialize.serializeSnapshot(actResult.snapshot)
        results.append(llmStepResultEntry(
            index: i, step: step, success: actResult.success, error: actResult.error, startedAtMs: startedAtMs
        ))

        if !actResult.success {
            overallSuccess = false
            if !continueOnError { break }
        }
    }

    var result: [String: Any] = [
        "sessionId": sessionId,
        "stepsExecuted": results.count,
        "stepsTotal": actions.count,
        "success": overallSuccess,
        "results": results,
    ]
    if let lastSnapshotSerialized { result["finalSnapshot"] = lastSnapshotSerialized }
    return result
}

private func llmStepResultEntry(
    index: Int, step: LlmStepActionInput, success: Bool, error: String?, startedAtMs: Double
) -> [String: Any] {
    var entry: [String: Any] = [
        "index": index, "type": step.type.rawValue, "elementId": step.elementId, "success": success,
        "durationMs": Int(Date().timeIntervalSince1970 * 1000 - startedAtMs),
    ]
    if let intent = step.intent { entry["intent"] = intent }
    if let error { entry["error"] = error }
    return entry
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - walkthrough
// ═══════════════════════════════════════════════════════════════════════════

/// Mirrors walkthrough.ts `WalkthroughParams.steps[]`.
struct WalkthroughStepInput {
    var intent: String
    var capture: Bool?
    var waitMs: Double?
}

/// Mirrors walkthrough.ts `handleWalkthrough` — loops `handleStep`, still
/// zero LLM calls. Scope note: TS's walkthrough.ts calls `handleCapture`
/// (src/mcp/tools/capture.ts, S4-owned CaptureOps.swift territory) for its
/// screenshot step, including an optional CDP/AX "clean" cosmetic pre-pass.
/// That helper isn't part of this file's owned symbols and its Swift name
/// isn't frozen anywhere, so this port captures the screenshot directly via
/// the frozen `Driver.screenshot()` instead — functionally equivalent for
/// FakeDriver/NativeDriver (the "clean" pass is CDP-only and a no-op for
/// both anyway per the plan), but is a smaller feature than TS's `clean`
/// flag (kept as an accepted-but-currently-unused param for wire-contract
/// parity; flagged as a blocker below).
func handleWalkthrough(
    sessionId: String, steps: [WalkthroughStepInput], clean: Bool?, ctx: DaemonContext
) throws -> [String: Any] {
    guard let driver = ctx.driverRegistry.get(sessionId) else {
        throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
    }
    _ = clean // accepted for wire-contract parity; see file-level note above.

    let startMs = Date().timeIntervalSince1970 * 1000
    var results: [[String: Any]] = []
    var stepsCompleted = 0

    for (i, step) in steps.enumerated() {
        var autoExecuted = false
        var action: String?
        var success = false
        var errorMsg: String?
        var screenshotPath: String?
        var state: String?
        var elementCount = 0

        do {
            let stepResponse = try handleStep(sessionId: sessionId, intent: step.intent, ctx: ctx)
            autoExecuted = (stepResponse["autoExecuted"] as? Bool) ?? false
            action = stepResponse["action"] as? String
            // A step only counts as "completed" if it was auto-executed —
            // steps that returned candidates without executing don't count.
            success = autoExecuted
            if autoExecuted { stepsCompleted += 1 }

            if stepResponse["snapshot"] != nil, let snap = try? driver.snapshot() {
                let stateDetection = detectState(snap)
                state = stateDetection.state.rawValue
                elementCount = snap.elements.count
            }
        } catch {
            success = false
            errorMsg = error.localizedDescription
        }

        if step.capture != false {
            let waitMs = step.waitMs ?? 500
            if waitMs > 0 { Thread.sleep(forTimeInterval: waitMs / 1000.0) }

            do {
                let screenshotData = try driver.screenshot()
                let stepIndex = ctx.sessions.get(sessionId)?.steps.count ?? i
                screenshotPath = writeStepScreenshot(sessionId: sessionId, index: stepIndex, data: screenshotData, ctx: ctx)

                if state == nil, let snap = try? driver.snapshot() {
                    let stateDetection = detectState(snap)
                    state = stateDetection.state.rawValue
                    elementCount = snap.elements.count
                }
            } catch {
                // Capture failure does not mark the step as failed — recorded separately.
                if errorMsg == nil {
                    errorMsg = "Capture failed: \(error.localizedDescription)"
                }
            }
        }

        var stepResult: [String: Any] = [
            "index": i, "intent": step.intent, "autoExecuted": autoExecuted, "success": success, "elementCount": elementCount,
        ]
        if let action { stepResult["action"] = action }
        if let errorMsg { stepResult["error"] = errorMsg }
        if let screenshotPath { stepResult["screenshotPath"] = screenshotPath }
        if let state { stepResult["state"] = state }
        results.append(stepResult)
    }

    let durationMs = Int(Date().timeIntervalSince1970 * 1000 - startMs)
    return [
        "success": stepsCompleted == steps.count,
        "stepsCompleted": stepsCompleted,
        "stepsTotal": steps.count,
        "results": results,
        "duration_ms": durationMs,
    ]
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - observe
// ═══════════════════════════════════════════════════════════════════════════

/// Mirrors core-impl.ts `observe`: snapshot ⊕ session ⊕ recording ⊕ optional analyze.
func handleObserve(
    sessionId: String, screenshotFlag: Bool?, analyzeFlag: Bool?, rawViewport: [String: Any]?, ctx: DaemonContext
) throws -> [String: Any] {
    guard let driver = ctx.driverRegistry.get(sessionId) else {
        throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
    }
    let snap = try driver.snapshot()

    var result: [String: Any] = [
        "snapshot": SnapshotSerialize.serializeSnapshot(snap),
        "elementCount": snap.elements.count,
    ]
    if let url = snap.url { result["url"] = url }
    if let appName = snap.appName { result["appName"] = appName }
    if screenshotFlag == true {
        let buf = try driver.screenshot()
        result["screenshot"] = buf.base64EncodedString()
    }

    result["sessionId"] = sessionId
    if let session = ctx.sessions.get(sessionId) {
        result["platform"] = session.platform
    }
    if let run = ctx.sessions.getRun(sessionId) {
        result["recording"] = run.recording.json
    }
    if analyzeFlag == true {
        result["analysis"] = try handleAnalyze(sessionId: sessionId, viewport: rawViewport, ctx: ctx)
    }
    return result
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - Shared helpers (file-private)
// ═══════════════════════════════════════════════════════════════════════════

private func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

/// Writes a step's screenshot bytes under the session's storage dir and
/// returns the resulting path — the Swift-side counterpart of what TS's
/// SessionManager.addStep does internally (it accepts a raw Buffer and
/// persists it itself). The FROZEN `SpectraSessionStep`/
/// `SpectraCaptureRunAction` shapes (SessionStore.swift, §4 of
/// DriverProtocol.swift) require `screenshotPath: String` up front, so that
/// responsibility falls to the caller (this file) in the Swift port.
/// Filename convention (`step-NNN.png`) matches SessionStore.swift's own
/// conformance-seed naming exactly (SessionStore.swift's
/// `seedConformanceSessionLocked`).
private func writeStepScreenshot(sessionId: String, index: Int, data: Data, ctx: DaemonContext) -> String {
    let dir = ctx.sessions.sessionDir(sessionId)
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let filename = "step-\(String(format: "%03d", index)).png"
    let path = (dir as NSString).appendingPathComponent(filename)
    try? data.write(to: URL(fileURLWithPath: path))
    return path
}

private func paramsDictStep(_ params: Any?) -> [String: Any] {
    (params as? [String: Any]) ?? [:]
}

private func requireSessionIdStep(_ dict: [String: Any]) throws -> String {
    guard let sessionId = dict["sessionId"] as? String, !sessionId.isEmpty else {
        throw DaemonApiError(.badRequest, "sessionId is required", status: 400)
    }
    return sessionId
}

// ═══════════════════════════════════════════════════════════════════════════
// MARK: - registerStepOps (the ONE W0-frozen hook bundling all 6 S3 ops)
// ═══════════════════════════════════════════════════════════════════════════

func registerStepOps(_ registry: HandlerRegistry) {
    registry.register("step", capabilities: [.uiAct]) { params, ctx in
        let dict = paramsDictStep(params)
        let sessionId = try requireSessionIdStep(dict)
        guard let intent = dict["intent"] as? String, !intent.isEmpty else {
            throw DaemonApiError(.badRequest, "intent is required", status: 400)
        }
        return try handleStep(sessionId: sessionId, intent: intent, ctx: ctx)
    }

    registry.register("llmStep", capabilities: [.uiAct]) { params, ctx in
        let dict = paramsDictStep(params)
        let sessionId = try requireSessionIdStep(dict)
        guard let rawActions = dict["actions"] as? [[String: Any]], !rawActions.isEmpty else {
            throw DaemonApiError(.badRequest, "actions must be a non-empty array", status: 400)
        }
        let actions: [LlmStepActionInput] = try rawActions.map { raw in
            guard let elementId = raw["elementId"] as? String,
                  let typeStr = raw["type"] as? String, let type = DriverActionType(rawValue: typeStr) else {
                throw DaemonApiError(.badRequest, "each action requires elementId and a valid type", status: 400)
            }
            return LlmStepActionInput(
                type: type, elementId: elementId,
                value: raw["value"] as? String, intent: raw["intent"] as? String,
                waitAfterMs: (raw["waitAfterMs"] as? NSNumber)?.doubleValue
            )
        }
        let continueOnError = (dict["continueOnError"] as? Bool) ?? false
        return try handleLlmStep(sessionId: sessionId, actions: actions, continueOnError: continueOnError, ctx: ctx)
    }

    registry.register("walkthrough", capabilities: [.uiAct, .mediaCapture]) { params, ctx in
        let dict = paramsDictStep(params)
        let sessionId = try requireSessionIdStep(dict)
        guard let rawSteps = dict["steps"] as? [[String: Any]], !rawSteps.isEmpty else {
            throw DaemonApiError(.badRequest, "steps must be a non-empty array", status: 400)
        }
        let steps: [WalkthroughStepInput] = try rawSteps.map { raw in
            guard let intent = raw["intent"] as? String, !intent.isEmpty else {
                throw DaemonApiError(.badRequest, "each step requires intent", status: 400)
            }
            return WalkthroughStepInput(intent: intent, capture: raw["capture"] as? Bool, waitMs: (raw["waitMs"] as? NSNumber)?.doubleValue)
        }
        let clean = dict["clean"] as? Bool
        return try handleWalkthrough(sessionId: sessionId, steps: steps, clean: clean, ctx: ctx)
    }

    registry.register("observe", capabilities: [.uiRead]) { params, ctx in
        let dict = paramsDictStep(params)
        let sessionId = try requireSessionIdStep(dict)
        return try handleObserve(
            sessionId: sessionId,
            screenshotFlag: dict["screenshot"] as? Bool,
            analyzeFlag: dict["analyze"] as? Bool,
            rawViewport: dict["viewport"] as? [String: Any],
            ctx: ctx
        )
    }

    registry.register("analyze", capabilities: [.analysisRead]) { params, ctx in
        let dict = paramsDictStep(params)
        let sessionId = try requireSessionIdStep(dict)
        return try handleAnalyze(sessionId: sessionId, viewport: dict["viewport"] as? [String: Any], ctx: ctx)
    }

    registry.register("discover", capabilities: [.discoverWrite, .uiAct, .mediaCapture]) { params, ctx in
        let dict = paramsDictStep(params)
        let sessionId = try requireSessionIdStep(dict)
        return try handleDiscover(
            sessionId: sessionId,
            maxDepth: (dict["maxDepth"] as? NSNumber)?.intValue,
            maxScreens: (dict["maxScreens"] as? NSNumber)?.intValue,
            captureStates: dict["captureStates"] as? Bool,
            clean: dict["clean"] as? Bool,
            outputDir: dict["outputDir"] as? String,
            ctx: ctx
        )
    }
}
