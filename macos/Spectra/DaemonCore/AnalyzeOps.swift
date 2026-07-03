// macos/Spectra/DaemonCore/AnalyzeOps.swift
//
// M3.G2 (S3, step-intelligence-engine) — `analyze`: heuristic scoring over
// the CURRENT driver snapshot. Port of src/mcp/tools/analyze.ts, built
// entirely on Intelligence.swift's importance/states heuristics. Fully
// deterministic — no LLM, no CDP. `consoleErrors` is always `[]` for every
// G2 conformer: TS's `driver.console?.getErrors()` escape hatch is a
// CDP-only driver feature that is intentionally NOT part of the frozen
// `Driver` protocol (DriverProtocol.swift's rally-handoff note reserves any
// such CDP-only extension to M4's CdpDriver via its own supplementary type).
//
// Registration lives in StepOps.swift's single `registerStepOps` hook (the
// W0-frozen contract bundles observe/step/llmStep/walkthrough/analyze/
// discover under ONE register function) — this file only exposes the pure
// `handleAnalyze` handler.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// Mirrors analyze.ts `handleAnalyze`. `viewport` is the raw decoded JSON
/// object for the optional `{width,height,devicePixelRatio}` param (already
/// validated non-empty by the caller in StepOps.swift); defaults mirror
/// analyze.ts's own `?? 1280`/`?? 800`/`?? 1`.
func handleAnalyze(sessionId: String, viewport rawViewport: [String: Any]?, ctx: DaemonContext) throws -> [String: Any] {
    guard let driver = ctx.driverRegistry.get(sessionId) else {
        throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
    }
    let snapshot = try driver.snapshot()

    let viewport = Viewport(
        width: (rawViewport?["width"] as? NSNumber)?.doubleValue ?? 1280,
        height: (rawViewport?["height"] as? NSNumber)?.doubleValue ?? 800,
        devicePixelRatio: (rawViewport?["devicePixelRatio"] as? NSNumber)?.doubleValue ?? 1
    )

    let scores = scoreElements(snapshot.elements, viewport)
    let regions = findRegions(scores, snapshot.elements)
    let stateDetection = detectState(snapshot)

    let elemMap = Dictionary(uniqueKeysWithValues: snapshot.elements.map { ($0.id, $0) })

    let topElements: [[String: Any]] = scores.prefix(10).map { s in
        let el = elemMap[s.elementId]
        let bounds = el?.bounds ?? DriverBounds(x: 0, y: 0, width: 0, height: 0)
        return [
            "id": s.elementId,
            "role": el?.role ?? "unknown",
            "label": el?.label ?? "",
            "importance": roundTo3(s.score),
            "bounds": bounds.asArray,
        ]
    }

    let regionsJSON: [[String: Any]] = regions.map { r in
        [
            "label": r.label,
            "score": roundTo3(r.score),
            "bounds": r.bounds.asArray,
            "elementCount": r.elements.count,
        ]
    }

    return [
        "state": stateDetection.state.rawValue,
        "stateConfidence": roundTo3(stateDetection.confidence),
        "regions": regionsJSON,
        "topElements": topElements,
        "totalElements": snapshot.elements.count,
        "consoleErrors": [] as [[String: Any]],
    ]
}

/// Mirrors analyze.ts's `Math.round(x * 1000) / 1000`.
private func roundTo3(_ v: Double) -> Double { (v * 1000).rounded() / 1000 }
