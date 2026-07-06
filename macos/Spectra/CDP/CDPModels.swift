// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

public enum CDPActionType: String, Sendable {
    case click
    case type
    case clear
    case select
    case scroll
    case hover
    case focus
}

public struct CDPElement: Equatable, Sendable {
    public var id: String
    public var role: String
    public var label: String
    public var value: String?
    public var enabled: Bool
    public var focused: Bool
    public var actions: [String]
    public var bounds: [Double]
    public var parent: String?
}

public struct CDPSnapshot: Sendable {
    public var url: String?
    public var platform: String
    public var elements: [CDPElement]
    public var timestamp: Int64
    public var metadata: CDPSnapshotMetadata
}

public struct CDPSnapshotMetadata: Sendable {
    public var elementCount: Int
    public var timedOut: Bool
}

public struct CDPActResult: Sendable {
    public var success: Bool
    public var error: String?
    public var snapshot: CDPSnapshot
}

public struct CDPDriverTarget: Sendable {
    public var url: String?

    public init(url: String? = nil) {
        self.url = url
    }
}

public enum CDPError: Error, LocalizedError {
    case notConnected
    case connectionFailed(String)
    case browserNotFound([String])
    case debuggerUnavailable(port: Int)
    case protocolError(code: Int, message: String)
    case timeout(method: String, seconds: Int)
    case invalidResponse(String)
    case webSocketClosed

    public var errorDescription: String? {
        switch self {
        case .notConnected:
            return "Not connected"
        case .connectionFailed(let url):
            return "WebSocket connection failed: \(url)"
        case .browserNotFound(let paths):
            return "Chrome not found. Checked: \(paths.joined(separator: ", "))"
        case .debuggerUnavailable(let port):
            return "Chrome debugger did not respond within 5s on port \(port). Is another Chrome instance using this port?"
        case .protocolError(let code, let message):
            return "CDP error \(code): \(message)"
        case .timeout(let method, let seconds):
            return "CDP request '\(method)' timed out after \(seconds)s. The browser may be unresponsive or the operation is taking too long."
        case .invalidResponse(let message):
            return message
        case .webSocketClosed:
            return "WebSocket closed"
        }
    }
}

enum CDPJSON {
    static func dictionary(_ value: Any?) -> [String: Any] {
        value as? [String: Any] ?? [:]
    }

    static func array(_ value: Any?) -> [[String: Any]] {
        value as? [[String: Any]] ?? []
    }

    static func string(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    static func int(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }

    static func double(_ value: Any?) -> Double? {
        if let double = value as? Double { return double }
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String { return Double(string) }
        return nil
    }

    static func bool(_ value: Any?) -> Bool? {
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        if let string = value as? String {
            if string == "true" { return true }
            if string == "false" { return false }
        }
        return nil
    }

    static func millisNow() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1000).rounded())
    }
}

func normalizeWebRole(_ rawRole: String) -> String {
    let roles: [String: String] = [
        "button": "button",
        "textbox": "textfield",
        "TextField": "textfield",
        "link": "link",
        "checkbox": "checkbox",
        "switch": "switch",
        "slider": "slider",
        "tab": "tab",
        "combobox": "select",
        "listbox": "select",
        "heading": "heading",
        "img": "image",
        "image": "image",
        "StaticText": "text",
        "group": "group",
        "generic": "group",
        "navigation": "group",
        "main": "group",
        "contentinfo": "group",
        "banner": "group",
        "form": "group",
        "search": "group",
        "region": "group",
        "article": "group",
        "section": "group",
        "complementary": "group",
    ]
    return roles[rawRole] ?? "group"
}
