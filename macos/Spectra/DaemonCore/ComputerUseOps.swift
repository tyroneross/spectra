// macos/Spectra/DaemonCore/ComputerUseOps.swift
//
// M3.G2 (S2) — the `computerUse` op handler (registered via
// SnapshotOps.swift's frozen `registerAxOps` hook). SESSIONLESS: scoped by an
// AX target (pid/app), not a sessionId — mirrors src/daemon/core-impl.ts's
// `computerUse()` + `getOrCreateComputerUse()` (core-impl.ts:159's rationale:
// one ComputerUse instance PER DISTINCT TARGET, reused across calls, so a
// standalone act/click benefits from the same in-instance AX cache a prior
// snapshot/act built up — a fresh-per-call instance never accumulates state).
//
// Ports src/computer-use/computer-use.ts's AX-first orchestration
// (snapshotFocusedWindow / act / fillForm / label resolution ranking)
// against the SAME native `cuSnapshot`/`cuAct`/`cuKey` RPCs
// (src/computer-use/native-port.ts, native/swift/AXComputerUse.swift) via
// BridgeClient. SCOPE NOTE: this port is AX-only — the TS orchestration's
// vision-pixel-grounding fallback (src/computer-use/vision-fallback.ts,
// NativeVisionFallback) is NOT wired here. A thin/empty AX tree still
// surfaces `needsVisionFallback` as an honest signal (never a crash, per the
// TS contract's own "signal, not a crash" design), but this slice does not
// call a vision grounder to resolve it — TODO: Iteration N, wire
// NativeVisionFallback parity if a future milestone needs it. This mirrors
// the S2 brief's actual scope line (instance-cache + permission mapping),
// not a silent gap.
//
// AxPermissionError -> permission_denied / 403 with a Settings hint baked
// into the (masked-class) message — code+status are the byte-compared
// fields, mirroring core-impl.ts:877-884.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

// MARK: - AX node / snapshot model (mirrors src/computer-use/types.ts)

private struct CuAxNode {
    var role: String
    var label: String
    var value: String?
    var enabled: Bool
    var focused: Bool
    var actions: [String]
    var bounds: [Double] // [x, y, width, height]
    var path: [Int]
}

private struct CuWindow {
    var title: String
    var bounds: [Double]
}

private struct CuSnapshot {
    var window: CuWindow?
    var nodes: [CuAxNode]
    var nodeCount: Int
    var axStatus: String // "ok" | "empty" | "no-window"
    var focusedWindowTitle: String
    var needsVisionFallback: Bool
}

private struct CuTarget {
    var app: String?
    var pid: Int?

    var params: [String: Any] {
        var d: [String: Any] = [:]
        if let pid { d["pid"] = pid }
        else if let app { d["app"] = app }
        return d
    }

    /// Instance-cache key (core-impl.ts:159 rationale, ported verbatim).
    var key: String {
        if let pid { return "pid:\(pid)" }
        if let app { return "app:\(app)" }
        return "focused"
    }
}

private enum CuAction {
    case click(role: String?, label: String)
    case setValue(label: String, value: String)
    case key(key: String)
}

private struct CuActOutcome {
    var success: Bool
    var matched: Bool
    var verified: Bool?
    var actualValue: String?
    var error: String?
    var needsVisionFallback: Bool?
}

private struct CuFieldResult {
    var label: String
    var expected: String
    var matched: Bool
    var set: Bool
    var verified: Bool
    var actual: String?
    var error: String?
}

private struct CuFillFormResult {
    var fields: [CuFieldResult]
    var allVerified: Bool
    var needsVisionFallback: Bool
}

/// Thrown when the OS denies Accessibility access — mirrors
/// src/computer-use/port.ts's `AxPermissionError`.
private struct AxPermissionError: Error {
    let message: String
}

private func isPermissionMessage(_ message: String) -> Bool {
    let m = message.lowercased()
    return m.contains("accessibility permission") || m.contains("apidisabled") || m.contains("api disabled")
}

private let editableRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSecureTextField"]

private func cuNormalize(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

private func isEditable(_ node: CuAxNode) -> Bool {
    node.actions.contains("setValue") || editableRoles.contains(node.role)
}

private func numberToDouble(_ any: Any) -> Double {
    if let n = any as? NSNumber { return n.doubleValue }
    if let d = any as? Double { return d }
    return 0
}

private func parseCuNode(_ dict: [String: Any]) -> CuAxNode {
    let boundsRaw = ((dict["bounds"] as? [Any]) ?? []).map(numberToDouble)
    let pathRaw = ((dict["path"] as? [Any]) ?? []).map { ($0 as? NSNumber)?.intValue ?? 0 }
    return CuAxNode(
        role: dict["role"] as? String ?? "",
        label: dict["label"] as? String ?? "",
        value: dict["value"] as? String,
        enabled: dict["enabled"] as? Bool ?? true,
        focused: dict["focused"] as? Bool ?? false,
        actions: (dict["actions"] as? [String]) ?? [],
        bounds: boundsRaw.count == 4 ? boundsRaw : [0, 0, 0, 0],
        path: pathRaw
    )
}

// MARK: - Session (one per distinct target, cached — core-impl.ts:159)

/// AX-first, focused-window-scoped computer-use session. Ports
/// src/computer-use/computer-use.ts's `ComputerUse` class (AX-only slice —
/// see file header). All public entry points take this session's own lock,
/// so concurrent computerUse calls against the SAME target (the identical
/// same-session-race class the Driver protocol flags for NativeDriver) are
/// serialized here too — the cached `nodes`/label-resolution state is
/// exactly as racy as NativeDriver's `idToPath` would be if left unguarded.
private final class ComputerUseSession {
    private let target: CuTarget
    private let defaultThreshold: Int
    private var cache: CuSnapshot?
    private let lock = NSLock()

    init(target: CuTarget, defaultThreshold: Int = 1) {
        self.target = target
        self.defaultThreshold = defaultThreshold
    }

    func snapshotFocusedWindow(threshold overrideThreshold: Int?) throws -> CuSnapshot {
        lock.lock(); defer { lock.unlock() }
        return try snapshotLocked(threshold: overrideThreshold, refresh: false)
    }

    func act(_ action: CuAction) throws -> CuActOutcome {
        lock.lock(); defer { lock.unlock() }
        switch action {
        case .click(let role, let label): return try clickLocked(role: role, label: label)
        case .setValue(let label, let value): return try setValueLocked(label: label, value: value)
        case .key(let key): return try keyLocked(key: key)
        }
    }

    func fillForm(_ fields: [(label: String, value: String)]) throws -> CuFillFormResult {
        lock.lock(); defer { lock.unlock() }
        _ = try snapshotLocked(threshold: nil, refresh: false)

        var results: [CuFieldResult] = []
        for field in fields {
            guard resolveEditableLocked(label: field.label) != nil else {
                results.append(CuFieldResult(label: field.label, expected: field.value, matched: false, set: false, verified: false, actual: nil, error: nil))
                continue
            }
            let outcome = try setValueLocked(label: field.label, value: field.value)
            results.append(CuFieldResult(
                label: field.label,
                expected: field.value,
                matched: true,
                set: outcome.success,
                verified: outcome.verified ?? false,
                actual: outcome.actualValue,
                error: outcome.error
            ))
        }

        let anyMatched = results.contains { $0.matched }
        let allVerified = !results.isEmpty && results.allSatisfy { $0.verified }
        let needsVisionFallback = (cache?.needsVisionFallback ?? false) && !anyMatched
        return CuFillFormResult(fields: results, allVerified: allVerified, needsVisionFallback: needsVisionFallback)
    }

    // MARK: primitives — caller must hold `lock`

    private func snapshotLocked(threshold overrideThreshold: Int?, refresh: Bool) throws -> CuSnapshot {
        if let cache, !refresh { return cache }
        let effectiveThreshold = overrideThreshold ?? defaultThreshold

        let result: [String: Any]
        do {
            result = try BridgeClient.shared.send("cuSnapshot", params: target.params)
        } catch {
            let message = String(describing: error)
            if isPermissionMessage(message) {
                throw AxPermissionError(
                    message: "Accessibility permission not granted. Grant Accessibility permission to the "
                    + "Spectra daemon helper in System Settings → Privacy & Security → Accessibility, then retry."
                )
            }
            throw error
        }

        let windowDict = result["window"] as? [String: Any]
        let window: CuWindow? = windowDict.map {
            CuWindow(title: $0["title"] as? String ?? "", bounds: (($0["bounds"] as? [Any]) ?? []).map(numberToDouble))
        }
        let rawElements = (result["elements"] as? [[String: Any]]) ?? []
        let nodes = rawElements.map(parseCuNode)
        let axStatus = result["axStatus"] as? String ?? "empty"
        let focusedWindowTitle = result["focusedWindowTitle"] as? String ?? ""
        let nodeCount = (result["nodeCount"] as? NSNumber)?.intValue ?? nodes.count

        let needsVisionFallback = axStatus != "ok" || nodeCount < effectiveThreshold

        let snapshot = CuSnapshot(
            window: window,
            nodes: nodes,
            nodeCount: nodes.count,
            axStatus: axStatus,
            focusedWindowTitle: focusedWindowTitle,
            needsVisionFallback: needsVisionFallback
        )
        cache = snapshot
        return snapshot
    }

    private func clickLocked(role: String?, label: String) throws -> CuActOutcome {
        // Lazy self-snapshot: a standalone act/click call with no prior
        // in-instance snapshot must ground itself first (mirrors
        // computer-use.ts:206) — only when there is no cache yet.
        if cache == nil { _ = try snapshotLocked(threshold: nil, refresh: false) }
        guard let node = resolveByLabelLocked(label: label, role: role, prefer: { $0.actions.contains("press") }, require: nil) else {
            return unresolvedLocked(label: label)
        }
        let res = try BridgeClient.shared.send("cuAct", params: mergeTargetParams([
            "elementPath": node.path,
            "action": "press",
        ]))
        cache = nil // a click may mutate the window arbitrarily
        return CuActOutcome(
            success: (res["success"] as? Bool) ?? false,
            matched: true,
            verified: nil,
            actualValue: nil,
            error: res["error"] as? String,
            needsVisionFallback: nil
        )
    }

    private func setValueLocked(label: String, value: String) throws -> CuActOutcome {
        if cache == nil { _ = try snapshotLocked(threshold: nil, refresh: false) }
        guard let node = resolveEditableLocked(label: label) else {
            return unresolvedLocked(label: label)
        }
        let res = try BridgeClient.shared.send("cuAct", params: mergeTargetParams([
            "elementPath": node.path,
            "action": "setValue",
            "value": value,
        ]))
        let success = (res["success"] as? Bool) ?? false
        let actualValue = res["value"] as? String
        let verified = success && cuNormalize(actualValue ?? "") == cuNormalize(value)

        // Known change: patch the cached node's value in place instead of a
        // full re-walk (mirrors computer-use.ts:240-245).
        if verified, var snap = cache, let idx = snap.nodes.firstIndex(where: { $0.path == node.path }) {
            snap.nodes[idx].value = actualValue ?? value
            cache = snap
        }

        return CuActOutcome(
            success: success,
            matched: true,
            verified: verified,
            actualValue: actualValue,
            error: res["error"] as? String,
            needsVisionFallback: nil
        )
    }

    private func keyLocked(key: String) throws -> CuActOutcome {
        let res = try BridgeClient.shared.send("cuKey", params: mergeTargetParams(["key": key]))
        cache = nil
        return CuActOutcome(
            success: (res["success"] as? Bool) ?? false,
            matched: true,
            verified: nil,
            actualValue: nil,
            error: res["error"] as? String,
            needsVisionFallback: nil
        )
    }

    private func mergeTargetParams(_ extra: [String: Any]) -> [String: Any] {
        var d = target.params
        for (k, v) in extra { d[k] = v }
        return d
    }

    // MARK: resolution (ports computer-use.ts's resolveByLabel ranking verbatim)

    private func resolveEditableLocked(label: String) -> CuAxNode? {
        resolveByLabelLocked(label: label, role: nil, prefer: isEditable, require: isEditable)
    }

    private func resolveByLabelLocked(
        label: String,
        role: String?,
        prefer: ((CuAxNode) -> Bool)?,
        require: ((CuAxNode) -> Bool)?
    ) -> CuAxNode? {
        let nodes = cache?.nodes ?? []
        let target = cuNormalize(label)

        // Match strength, strongest first — 'targetInLabel' (search term is
        // fully contained in the node's label) must outrank 'labelInTarget'
        // (the node's label is merely a substring of the search term): the
        // latter is the weaker, more accident-prone direction (ported
        // verbatim from computer-use.ts's MatchKind rank comment).
        enum MatchKind: Int { case labelInTarget = 0, targetInLabel = 1, exact = 2 }

        var matched: [(node: CuAxNode, kind: MatchKind)] = []
        for n in nodes {
            if let role, cuNormalize(n.role) != cuNormalize(role) { continue }
            if let require, !require(n) { continue }
            let nl = cuNormalize(n.label)
            if nl.isEmpty { continue }
            if nl == target { matched.append((n, .exact)) }
            else if nl.contains(target) { matched.append((n, .targetInLabel)) }
            else if target.contains(nl) { matched.append((n, .labelInTarget)) }
        }
        guard !matched.isEmpty else { return nil }

        // Exact-match-preferred: once an exact label match exists, no
        // substring candidate is eligible to shadow it.
        let hasExact = matched.contains { $0.kind == .exact }
        let eligible = hasExact ? matched.filter { $0.kind == .exact } : matched

        let sorted = eligible.sorted { a, b in
            if a.kind.rawValue != b.kind.rawValue { return a.kind.rawValue > b.kind.rawValue }
            if let prefer {
                let ap = prefer(a.node) ? 1 : 0
                let bp = prefer(b.node) ? 1 : 0
                if ap != bp { return ap > bp }
            }
            return a.node.label.count < b.node.label.count
        }
        return sorted.first?.node
    }

    /// Unresolved target: not a crash — signals a vision fallback when the
    /// tree is thin (this slice does not act on that signal — see file
    /// header scope note).
    private func unresolvedLocked(label: String) -> CuActOutcome {
        let thin = cache?.needsVisionFallback ?? true
        return CuActOutcome(
            success: false,
            matched: false,
            verified: nil,
            actualValue: nil,
            error: "No AX node matched \"\(label)\" in the focused window."
                + (thin ? " AX tree is empty/thin — vision fallback recommended." : ""),
            needsVisionFallback: thin
        )
    }
}

/// Process-wide instance cache, keyed by target (core-impl.ts:159
/// rationale). Thread-safe: `getOrCreate` is the only mutator, guarded by a
/// lock, mirroring DriverRegistry's own get/set discipline.
private final class ComputerUseSessionRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var table: [String: ComputerUseSession] = [:]

    func getOrCreate(target: CuTarget) -> ComputerUseSession {
        lock.lock(); defer { lock.unlock() }
        if let existing = table[target.key] { return existing }
        let session = ComputerUseSession(target: target)
        table[target.key] = session
        return session
    }
}

private let computerUseSessions = ComputerUseSessionRegistry()

// MARK: - Result encoding (mirrors ComputerUseResult in src/daemon/core-impl.ts)

private func nodeJSON(_ n: CuAxNode) -> [String: Any] {
    [
        "role": n.role,
        "label": n.label,
        "value": n.value ?? NSNull(),
        "enabled": n.enabled,
        "focused": n.focused,
        "actions": n.actions,
        "bounds": n.bounds,
        "path": n.path,
    ]
}

private func snapshotResultJSON(_ snap: CuSnapshot) -> [String: Any] {
    [
        "action": "snapshot",
        "window": snap.window.map { ["title": $0.title, "bounds": $0.bounds] as [String: Any] } ?? NSNull(),
        "nodes": snap.nodes.map(nodeJSON),
        "nodeCount": snap.nodeCount,
        "axStatus": snap.axStatus,
        "focusedWindowTitle": snap.focusedWindowTitle,
        "needsVisionFallback": snap.needsVisionFallback,
    ]
}

private func actOutcomeJSON(_ outcome: CuActOutcome) -> [String: Any] {
    var d: [String: Any] = [
        "action": "act",
        "success": outcome.success,
        "matched": outcome.matched,
    ]
    if let verified = outcome.verified { d["verified"] = verified }
    if let actualValue = outcome.actualValue { d["actualValue"] = actualValue }
    if let error = outcome.error { d["error"] = error }
    if let needsVisionFallback = outcome.needsVisionFallback { d["needsVisionFallback"] = needsVisionFallback }
    return d
}

private func fillFormResultJSON(_ result: CuFillFormResult) -> [String: Any] {
    [
        "action": "fill-form",
        "fields": result.fields.map { field -> [String: Any] in
            var d: [String: Any] = [
                "label": field.label,
                "expected": field.expected,
                "matched": field.matched,
                "set": field.set,
                "verified": field.verified,
            ]
            if let actual = field.actual { d["actual"] = actual }
            if let error = field.error { d["error"] = error }
            return d
        },
        "allVerified": result.allVerified,
        "needsVisionFallback": result.needsVisionFallback,
    ]
}

// MARK: - Op handler

func registerComputerUseHandler(_ registry: HandlerRegistry) {
    registry.register("computerUse", capabilities: [.uiRead, .uiAct]) { params, ctx in
        let dict = axParamsDict(params)
        guard let action = dict["action"] as? String else {
            throw DaemonApiError(.badRequest, "action is required", status: 400)
        }

        var target = CuTarget()
        if let pidNum = dict["pid"] as? NSNumber { target.pid = pidNum.intValue }
        else if let appName = dict["app"] as? String { target.app = appName }

        let session = computerUseSessions.getOrCreate(target: target)

        do {
            switch action {
            case "snapshot":
                let threshold = (dict["threshold"] as? NSNumber)?.intValue
                let snap = try session.snapshotFocusedWindow(threshold: threshold)
                return snapshotResultJSON(snap)

            case "act":
                guard let opDict = dict["op"] as? [String: Any], let kind = opDict["kind"] as? String else {
                    throw DaemonApiError(.badRequest, "op is required for computerUse action=act", status: 400)
                }
                let cuAction: CuAction
                switch kind {
                case "click":
                    guard let label = opDict["label"] as? String else {
                        throw DaemonApiError(.badRequest, "op.label is required for kind=click", status: 400)
                    }
                    cuAction = .click(role: opDict["role"] as? String, label: label)
                case "set-value":
                    guard let label = opDict["label"] as? String, let value = opDict["value"] as? String else {
                        throw DaemonApiError(.badRequest, "op.label and op.value are required for kind=set-value", status: 400)
                    }
                    cuAction = .setValue(label: label, value: value)
                case "key":
                    guard let key = opDict["key"] as? String else {
                        throw DaemonApiError(.badRequest, "op.key is required for kind=key", status: 400)
                    }
                    cuAction = .key(key: key)
                default:
                    throw DaemonApiError(.badRequest, "op.kind must be one of: click, set-value, key", status: 400)
                }
                let outcome = try session.act(cuAction)
                return actOutcomeJSON(outcome)

            case "fill-form":
                guard let fieldsDict = dict["fields"] as? [String: Any] else {
                    throw DaemonApiError(.badRequest, "fields is required for computerUse action=fill-form", status: 400)
                }
                let fields: [(label: String, value: String)] = fieldsDict.compactMap { key, value in
                    guard let strValue = value as? String else { return nil }
                    return (label: key, value: strValue)
                }
                let result = try session.fillForm(fields)
                return fillFormResultJSON(result)

            default:
                throw DaemonApiError(.badRequest, "action must be one of: snapshot, act, fill-form", status: 400)
            }
        } catch let axErr as AxPermissionError {
            // Byte-parity target: code + status (core-impl.ts:878-884);
            // message is a pre-ruled masked class.
            throw DaemonApiError(.permissionDenied, axErr.message, status: 403)
        } catch let apiErr as DaemonApiError {
            throw apiErr
        } catch {
            throw DaemonApiError(.internalError, "computerUse failed: \(error)", status: 500)
        }
    }
}
