// macos/Spectra/DaemonCore/DiscoverOps.swift
//
// M3.G2 (S3, step-intelligence-engine) — `discover`: BFS crawl
// (Intelligence.swift's `crawl`, a port of src/intelligence/navigation.ts)
// + auto-framing (`frame`, framing.ts) + a best-effort manifest.json write.
// Port of src/mcp/tools/discover.ts. Entirely driver-only (snapshot/act/
// screenshot) — no CDP connection, no LLM, no vision model.
//
// Scope note (blocker-worthy, see the returned summary): TS's discover.ts
// also calls `driver.getConnection?.()` + src/media/clean.ts's
// prepareForCapture/restoreAfterCapture for a CDP-only pre-capture cosmetic
// pass (hide cursor, close devtools overlay, etc.). `getConnection` is
// explicitly OUT of the frozen `Driver` protocol (DriverProtocol.swift's
// rally-handoff note — CDP-only, M4/Codex's concern). Neither FakeDriver nor
// NativeDriver ever has a CDP connection, so this pass is UNREACHABLE for
// every G2 conformer regardless — this port omits it rather than fabricate
// a no-op call to a method that doesn't exist on the frozen protocol.
//
// Registration lives in StepOps.swift's single `registerStepOps` hook.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

/// Mirrors discover.ts `handleDiscover`.
func handleDiscover(
    sessionId: String,
    maxDepth: Int?,
    maxScreens: Int?,
    captureStates: Bool?,
    clean: Bool?,
    outputDir explicitOutputDir: String?,
    ctx: DaemonContext
) throws -> [String: Any] {
    guard let driver = ctx.driverRegistry.get(sessionId) else {
        throw DaemonApiError(.notFound, "Session \(sessionId) not found", status: 404)
    }

    let startTimeMs = Date().timeIntervalSince1970 * 1000

    // Prefer the frozen SessionStore.sessionDir(_:) so a repoPath supplied at
    // connect time anchors discovery output consistently with every other
    // session-scoped artifact (mirrors discover.ts's own sessionDir-first,
    // storage-path-fallback preference — `ctx.sessions.sessionDir` never
    // throws per its frozen contract, so no fallback branch is needed here).
    let outputDir = explicitOutputDir ?? (ctx.sessions.sessionDir(sessionId) as NSString).appendingPathComponent("discover")
    try? FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

    let viewport = Viewport(width: 1280, height: 800, devicePixelRatio: 1)

    var options = CrawlOptions()
    options.maxDepth = maxDepth ?? 3
    options.maxScreens = maxScreens ?? 50

    let graph = crawl(driver: driver, options: options)

    var captures: [[String: Any]] = []
    var sensitive: [String] = []

    for nodeId in graph.nodeOrder {
        guard let node = graph.nodes[nodeId] else { continue }
        if node.sensitiveContent == true {
            sensitive.append(nodeId)
            continue
        }

        let snapshot: DriverSnapshot
        if let cached = graph.snapshotCache[nodeId] {
            snapshot = cached.snapshot
        } else if let fresh = try? driver.snapshot() {
            snapshot = fresh
        } else {
            continue
        }

        let scores = scoreElements(snapshot.elements, viewport)
        let state = detectState(snapshot)
        let safeName = sanitizeFilename(nodeId)

        guard !node.screenshot.isEmpty else { continue }

        let filename = "screen-\(safeName).png"
        let path = (outputDir as NSString).appendingPathComponent(filename)
        try? node.screenshot.write(to: URL(fileURLWithPath: path))

        let avgImportance = scores.isEmpty ? 0 : scores.reduce(0.0) { $0 + $1.score } / Double(scores.count)
        captures.append([
            "path": path,
            "state": state.state.rawValue,
            "importance": avgImportance,
            "framed": false,
            "timestamp": Int(Date().timeIntervalSince1970 * 1000),
        ])

        // Auto-frame the best region. Mirrors discover.ts's try/catch:
        // framing can fail (e.g. an unsupported PNG color type, or a
        // screenshot too small to crop meaningfully) — skip silently.
        if !scores.isEmpty {
            do {
                let framed = try frame(screenshot: node.screenshot, scores: scores, elements: snapshot.elements)
                let framedFilename = "framed-\(safeName).png"
                let framedPath = (outputDir as NSString).appendingPathComponent(framedFilename)
                try framed.buffer.write(to: URL(fileURLWithPath: framedPath))
                captures.append([
                    "path": framedPath,
                    "state": state.state.rawValue,
                    "importance": scores.first?.score ?? 0,
                    "region": framed.label,
                    "framed": true,
                    "timestamp": Int(Date().timeIntervalSince1970 * 1000),
                ])
            } catch {
                // Framing failure is expected + non-fatal — see file header.
            }
        }
    }

    // State triggers (`captureStates`): createStateTriggers() always
    // returns [] for every G2 driver (no CDP connection) — no-op, mirrors
    // states.ts's own web+conn-only gate exactly.
    _ = captureStates

    let durationMs = Int(Date().timeIntervalSince1970 * 1000 - startTimeMs)

    writeManifest(
        sessionId: sessionId, captures: captures, graph: graph, durationMs: durationMs, outputDir: outputDir
    )

    return [
        "screens": graph.nodes.count,
        "captures": captures.count,
        "sensitive": sensitive,
        "manifestPath": (outputDir as NSString).appendingPathComponent("manifest.json"),
        "outputDir": outputDir,
    ]
}

/// Best-effort manifest.json write. NOT part of DiscoverResult's wire
/// contract (only `screens`/`captures`/`sensitive`/`manifestPath`/
/// `outputDir` are validated against contract.spec.json) — this file is a
/// convenience artifact for humans/tooling browsing `.spectra/sessions/*/
/// discover/`, so its exact shape is not byte-parity-gated.
private func writeManifest(
    sessionId: String, captures: [[String: Any]], graph: NavigationGraph, durationMs: Int, outputDir: String
) {
    let nodesJSON: [String: Any] = Dictionary(uniqueKeysWithValues: graph.nodeOrder.compactMap { id -> (String, [String: Any])? in
        guard let n = graph.nodes[id] else { return nil }
        var d: [String: Any] = ["id": n.id, "importance": n.importance, "visited": n.visited]
        if let url = n.url { d["url"] = url }
        if let appName = n.appName { d["appName"] = appName }
        if let sensitiveContent = n.sensitiveContent { d["sensitiveContent"] = sensitiveContent }
        return (id, d)
    })

    let edgesJSON: [[String: Any]] = graph.edges.map { e in
        [
            "from": e.from, "to": e.to,
            "action": ["elementId": e.action.elementId, "type": e.action.type.rawValue, "label": e.action.label],
        ]
    }

    let manifest: [String: Any] = [
        "sessionId": sessionId,
        "captures": captures,
        "navigation": ["nodes": nodesJSON, "edges": edgesJSON, "root": graph.root],
        "duration": durationMs,
    ]

    let manifestPath = (outputDir as NSString).appendingPathComponent("manifest.json")
    guard let data = try? JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted]) else { return }
    try? data.write(to: URL(fileURLWithPath: manifestPath))
}

/// Mirrors discover.ts's `nodeId.replace(/[^a-z0-9]/gi, '_')` — ASCII
/// alnum-only allowlist (Swift's `Character.isLetter/.isNumber` would be
/// Unicode-broad and diverge from the JS regex's ASCII-only `a-z0-9`).
private func sanitizeFilename(_ s: String) -> String {
    String(s.map { ch -> Character in
        guard ch.unicodeScalars.count == 1, let v = ch.unicodeScalars.first?.value else { return "_" }
        let isLower = v >= 97 && v <= 122
        let isUpper = v >= 65 && v <= 90
        let isDigit = v >= 48 && v <= 57
        return (isLower || isUpper || isDigit) ? ch : "_"
    })
}
