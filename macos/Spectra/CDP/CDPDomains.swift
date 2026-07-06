// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

public final class CDPTargetDomain {
    private let connection: CDPConnection

    public init(connection: CDPConnection) {
        self.connection = connection
    }

    public func createPage(url: String) async throws -> String {
        let result = try await connection.sendDictionary("Target.createTarget", params: ["url": url])
        guard let targetID = result["targetId"] as? String else {
            throw CDPError.invalidResponse("Target.createTarget did not return targetId")
        }
        return targetID
    }

    public func attach(targetID: String) async throws -> String {
        let result = try await connection.sendDictionary(
            "Target.attachToTarget",
            params: ["targetId": targetID, "flatten": true]
        )
        guard let sessionID = result["sessionId"] as? String else {
            throw CDPError.invalidResponse("Target.attachToTarget did not return sessionId")
        }
        return sessionID
    }

    public func close(targetID: String) async throws {
        _ = try await connection.send("Target.closeTarget", params: ["targetId": targetID])
    }

    public func list() async throws -> [[String: Any]] {
        let result = try await connection.sendDictionary("Target.getTargets")
        return CDPJSON.array(result["targetInfos"])
    }
}

public final class CDPPageDomain {
    private let connection: CDPConnection
    private let sessionID: String?

    public init(connection: CDPConnection, sessionID: String?) {
        self.connection = connection
        self.sessionID = sessionID
    }

    @discardableResult
    public func navigate(url: String) async throws -> String {
        let result = try await connection.sendDictionary("Page.navigate", params: ["url": url], sessionID: sessionID)
        return result["frameId"] as? String ?? ""
    }

    public func screenshot(format: String = "png", quality: Int? = nil, clip: [String: Any]? = nil) async throws -> Data {
        var params: [String: Any] = ["format": format]
        if let quality, format == "jpeg" {
            params["quality"] = quality
        }
        if var clip {
            if clip["scale"] == nil { clip["scale"] = 1 }
            params["clip"] = clip
        }
        let result = try await connection.sendDictionary("Page.captureScreenshot", params: params, sessionID: sessionID)
        guard let encoded = result["data"] as? String, let data = Data(base64Encoded: encoded) else {
            throw CDPError.invalidResponse("Page.captureScreenshot did not return base64 data")
        }
        return data
    }

    public func enableLifecycleEvents() async throws {
        _ = try await connection.send("Page.setLifecycleEventsEnabled", params: ["enabled": true], sessionID: sessionID)
        _ = try await connection.send("Page.enable", params: [:], sessionID: sessionID)
    }
}

public final class CDPRuntimeDomain {
    private let connection: CDPConnection
    private let sessionID: String?

    public init(connection: CDPConnection, sessionID: String?) {
        self.connection = connection
        self.sessionID = sessionID
    }

    public func evaluate(_ expression: String) async throws -> Any? {
        let result = try await connection.sendDictionary(
            "Runtime.evaluate",
            params: ["expression": expression, "returnByValue": true],
            sessionID: sessionID
        )
        return CDPJSON.dictionary(result["result"])["value"]
    }
}

public final class CDPDOMDomain {
    private let connection: CDPConnection
    private let sessionID: String?

    public init(connection: CDPConnection, sessionID: String?) {
        self.connection = connection
        self.sessionID = sessionID
    }

    public func getElementCenter(backendNodeID: Int) async throws -> (x: Double, y: Double) {
        let result = try await connection.sendDictionary(
            "DOM.getBoxModel",
            params: ["backendNodeId": backendNodeID],
            sessionID: sessionID
        )
        let model = CDPJSON.dictionary(result["model"])
        guard let quad = model["content"] as? [Any], quad.count >= 8 else {
            throw CDPError.invalidResponse("DOM.getBoxModel did not return a content quad")
        }
        let values = quad.compactMap(CDPJSON.double)
        guard values.count >= 8 else {
            throw CDPError.invalidResponse("DOM.getBoxModel content quad was not numeric")
        }
        let x = ((values[0] + values[2] + values[4] + values[6]) / 4).rounded()
        let y = ((values[1] + values[3] + values[5] + values[7]) / 4).rounded()
        return (x, y)
    }

    public func getDocument() async throws -> [String: Any] {
        try await connection.sendDictionary("DOM.getDocument", params: [:], sessionID: sessionID)
    }
}

public final class CDPInputDomain {
    private let connection: CDPConnection
    private let sessionID: String?

    public init(connection: CDPConnection, sessionID: String?) {
        self.connection = connection
        self.sessionID = sessionID
    }

    public func click(x: Double, y: Double) async throws {
        _ = try await connection.send(
            "Input.dispatchMouseEvent",
            params: ["type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1],
            sessionID: sessionID
        )
        _ = try await connection.send(
            "Input.dispatchMouseEvent",
            params: ["type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1],
            sessionID: sessionID
        )
    }

    public func type(_ text: String) async throws {
        for char in text {
            let code = charToCode(String(char))
            _ = try await connection.send(
                "Input.dispatchKeyEvent",
                params: ["type": "keyDown", "text": String(char), "key": String(char), "code": code],
                sessionID: sessionID
            )
            _ = try await connection.send(
                "Input.dispatchKeyEvent",
                params: ["type": "keyUp", "key": String(char), "code": code],
                sessionID: sessionID
            )
        }
    }

    public func scroll(x: Double, y: Double, deltaX: Double, deltaY: Double) async throws {
        _ = try await connection.send(
            "Input.dispatchMouseEvent",
            params: ["type": "mouseWheel", "x": x, "y": y, "deltaX": deltaX, "deltaY": deltaY],
            sessionID: sessionID
        )
    }

    private func charToCode(_ char: String) -> String {
        let special: [String: String] = [
            " ": "Space", "0": "Digit0", "1": "Digit1", "2": "Digit2", "3": "Digit3",
            "4": "Digit4", "5": "Digit5", "6": "Digit6", "7": "Digit7", "8": "Digit8",
            "9": "Digit9", "`": "Backquote", "-": "Minus", "=": "Equal", "[": "BracketLeft",
            "]": "BracketRight", "\\": "Backslash", ";": "Semicolon", "'": "Quote",
            ",": "Comma", ".": "Period", "/": "Slash", "~": "Backquote", "!": "Digit1",
            "@": "Digit2", "#": "Digit3", "$": "Digit4", "%": "Digit5", "^": "Digit6",
            "&": "Digit7", "*": "Digit8", "(": "Digit9", ")": "Digit0", "_": "Minus",
            "+": "Equal", "{": "BracketLeft", "}": "BracketRight", "|": "Backslash",
            ":": "Semicolon", "\"": "Quote", "<": "Comma", ">": "Period", "?": "Slash",
            "\t": "Tab", "\n": "Enter",
        ]
        if let mapped = special[char] { return mapped }
        let upper = char.uppercased()
        if upper >= "A", upper <= "Z" { return "Key\(upper)" }
        return ""
    }
}

public struct CDPConsoleMessage: Sendable {
    public var type: String
    public var text: String
    public var url: String?
    public var lineNumber: Int?
    public var timestamp: Double
}

public final class CDPConsoleDomain {
    private let connection: CDPConnection
    private let sessionID: String?
    private var messages: [CDPConsoleMessage] = []
    private var handlers: [UUID: @Sendable (CDPConsoleMessage) -> Void] = [:]
    private var enabled = false

    public init(connection: CDPConnection, sessionID: String?) {
        self.connection = connection
        self.sessionID = sessionID
    }

    public func enable() async throws {
        guard !enabled else { return }
        enabled = true
        _ = try await connection.send("Runtime.enable", params: [:], sessionID: sessionID)
        connection.on("Runtime.consoleAPICalled") { [weak self] params in
            self?.handleConsole(params)
        }
    }

    @discardableResult
    public func onMessage(_ handler: @escaping @Sendable (CDPConsoleMessage) -> Void) -> UUID {
        let token = UUID()
        handlers[token] = handler
        return token
    }

    public func offMessage(_ token: UUID) {
        handlers.removeValue(forKey: token)
    }

    public func getMessages() -> [CDPConsoleMessage] {
        messages
    }

    public func getErrors() -> [CDPConsoleMessage] {
        messages.filter { $0.type == "error" || $0.type == "warning" }
    }

    public func clear() {
        messages.removeAll()
    }

    private func handleConsole(_ params: Any?) {
        let data = CDPJSON.dictionary(params)
        let args = CDPJSON.array(data["args"])
        let text = args.map { arg -> String in
            if let value = arg["value"] { return String(describing: value) }
            return CDPJSON.string(arg["description"]) ?? ""
        }.joined(separator: " ")
        let frame = CDPJSON.array(CDPJSON.dictionary(data["stackTrace"])["callFrames"]).first
        let message = CDPConsoleMessage(
            type: CDPJSON.string(data["type"]) ?? "log",
            text: text,
            url: CDPJSON.string(frame?["url"]),
            lineNumber: CDPJSON.int(frame?["lineNumber"]),
            timestamp: CDPJSON.double(data["timestamp"]) ?? Date().timeIntervalSince1970
        )
        messages.append(message)
        for handler in handlers.values {
            handler(message)
        }
    }
}

public final class CDPAccessibilityDomain {
    private let connection: CDPConnection
    private let sessionID: String?
    private var nodeMap: [String: Int] = [:]
    private let skipRoles: Set<String> = ["WebArea", "RootWebArea", "GenericContainer", "none", "IgnoredRole"]

    public init(connection: CDPConnection, sessionID: String?) {
        self.connection = connection
        self.sessionID = sessionID
    }

    public func enable() async throws {
        _ = try await connection.send("Accessibility.enable", params: [:], sessionID: sessionID)
    }

    public func getSnapshot() async throws -> [CDPElement] {
        let result = try await connection.sendDictionary("Accessibility.getFullAXTree", params: [:], sessionID: sessionID)
        return convertToElements(CDPJSON.array(result["nodes"]), clearMap: true)
    }

    public func getBackendNodeID(elementID: String) -> Int? {
        nodeMap[elementID]
    }

    public func queryAXTree(accessibleName: String? = nil, role: String? = nil) async throws -> [CDPElement] {
        let document = try await connection.sendDictionary("DOM.getDocument", params: [:], sessionID: sessionID)
        let root = CDPJSON.dictionary(document["root"])
        guard let nodeID = CDPJSON.int(root["nodeId"]) else { return [] }
        var params: [String: Any] = ["nodeId": nodeID]
        if let accessibleName { params["accessibleName"] = accessibleName }
        if let role { params["role"] = role }
        do {
            let result = try await connection.sendDictionary("Accessibility.queryAXTree", params: params, sessionID: sessionID)
            return convertToElements(CDPJSON.array(result["nodes"]), clearMap: false)
        } catch {
            return []
        }
    }

    private func convertToElements(_ nodes: [[String: Any]], clearMap: Bool) -> [CDPElement] {
        if clearMap { nodeMap.removeAll() }
        var elements: [CDPElement] = []
        for node in nodes {
            let roleObject = CDPJSON.dictionary(node["role"])
            let rawRole = CDPJSON.string(roleObject["value"]) ?? ""
            if skipRoles.contains(rawRole) { continue }

            let role = normalizeWebRole(rawRole)
            let label = CDPJSON.string(CDPJSON.dictionary(node["name"])["value"]) ?? ""
            if role == "group", label.isEmpty { continue }

            let backendID = CDPJSON.int(node["backendDOMNodeId"])
            let id = backendID.map { "e\($0)" } ?? "ex\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(6))"
            let value = CDPJSON.string(CDPJSON.dictionary(node["value"])["value"])
            let element = CDPElement(
                id: id,
                role: role,
                label: label,
                value: value,
                enabled: property(node, named: "disabled").flatMap(CDPJSON.bool) != true,
                focused: property(node, named: "focused").flatMap(CDPJSON.bool) == true,
                actions: inferActions(role: role),
                bounds: [0, 0, 0, 0],
                parent: nil
            )
            if let backendID {
                nodeMap[id] = backendID
            }
            elements.append(element)
        }
        return elements
    }

    private func property(_ node: [String: Any], named name: String) -> Any? {
        for property in CDPJSON.array(node["properties"]) where CDPJSON.string(property["name"]) == name {
            return CDPJSON.dictionary(property["value"])["value"]
        }
        return nil
    }

    private func inferActions(role: String) -> [String] {
        switch role {
        case "button", "link", "checkbox", "tab", "switch":
            return ["press"]
        case "textfield":
            return ["setValue"]
        case "slider":
            return ["increment", "decrement", "setValue"]
        case "select":
            return ["press", "showMenu"]
        default:
            return []
        }
    }
}

public func buildCDPFingerprint(_ elements: [CDPElement]) -> String {
    elements
        .filter { !$0.actions.isEmpty }
        .map { "\($0.role):\($0.label):\($0.enabled)" }
        .sorted()
        .joined(separator: "|")
}

public func waitForStableCDPTree(
    snapshot: @escaping () async throws -> [CDPElement],
    interval: TimeInterval = 0.1,
    stableTime: TimeInterval = 0.3,
    timeout: TimeInterval = 10
) async throws -> (elements: [CDPElement], timedOut: Bool) {
    var lastFingerprint = ""
    var stableSince = Date()
    let deadline = Date().addingTimeInterval(timeout)

    while Date() < deadline {
        let elements = try await snapshot()
        let fingerprint = buildCDPFingerprint(elements)
        if fingerprint == lastFingerprint {
            if Date().timeIntervalSince(stableSince) >= stableTime {
                return (elements, false)
            }
        } else {
            lastFingerprint = fingerprint
            stableSince = Date()
        }
        try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
    }

    return (try await snapshot(), true)
}
