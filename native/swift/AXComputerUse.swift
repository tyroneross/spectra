// native/swift/AXComputerUse.swift
//
// Computer-use AX operations, scoped to the FOCUSED window of a target app.
// This is the native half of the AX-first, vision-fallback capability slice
// (see src/computer-use/). It is strictly additive: it reuses walkAXTree /
// inferActions from AXBridge.swift and adds three things the snapshot/act path
// did not have:
//
//   1. focused-window scoping   — perceive only the key window (kAXFocusedWindow
//      → kAXMainWindow → first window), NOT the whole app tree. This is the
//      cheap "focus the key context" primitive; element paths are returned
//      RELATIVE to that window so navigation stays scoped.
//   2. read-back verification   — setValue reads kAXValue back so the TS layer
//      can verify each field post-set (form-filling as a first-class op).
//   3. an axStatus signal       — distinguishes ok / empty / no-window so the TS
//      layer can gate a vision fallback on AX-node-count instead of crashing on
//      an empty tree (kAXErrorCannotComplete for Qt/Electron/canvas apps).
//
// SPDX-License-Identifier: Apache-2.0

import Foundation
import ApplicationServices
import AppKit
import CoreGraphics

// ─── Result Types ─────────────────────────────────────────

struct FocusedSnapshotResult: Codable {
    let window: WindowInfo?
    let elements: [NativeElement]
    let nodeCount: Int
    // "ok" | "empty" | "no-window" — TS gates the vision fallback on this + nodeCount.
    let axStatus: String
    let focusedWindowTitle: String
}

struct ActValueResult: Codable {
    let success: Bool
    // Post-action read-back of kAXValue (setValue verification); nil for press/key.
    let value: String?
    let error: String?
}

struct PreflightResult: Codable {
    let trusted: Bool
}

// ─── Target Resolution (focused-app default) ──────────────

/// Resolve the target pid. Explicit `app`/`pid` win; otherwise fall back to the
/// frontmost application so "computer use" defaults to the key window with no
/// target specified — the "focus the key window" requirement.
func resolveComputerUsePid(from params: [String: AnyCodableValue]?) -> Result<pid_t, AppTargetError> {
    if let params = params, params["pid"] != nil || params["app"] != nil {
        return getAppPid(from: params)
    }
    // No explicit target → frontmost app (main thread; NSWorkspace requirement).
    var pid: pid_t? = nil
    let read = { pid = NSWorkspace.shared.frontmostApplication?.processIdentifier }
    if Thread.isMainThread { read() } else { DispatchQueue.main.sync(execute: read) }
    guard let resolved = pid else { return .failure(.appNotRunning("frontmost")) }
    return .success(resolved)
}

// ─── Focused Window ───────────────────────────────────────

/// The focused window of the app, with graceful fallbacks. Returns nil only if
/// the app has no windows at all.
func focusedWindowElement(app: AXUIElement) -> AXUIElement? {
    var ref: CFTypeRef?
    if AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &ref) == .success,
       let win = ref, CFGetTypeID(win) == AXUIElementGetTypeID() {
        return (win as! AXUIElement)
    }
    ref = nil
    if AXUIElementCopyAttributeValue(app, kAXMainWindowAttribute as CFString, &ref) == .success,
       let win = ref, CFGetTypeID(win) == AXUIElementGetTypeID() {
        return (win as! AXUIElement)
    }
    ref = nil
    if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &ref) == .success,
       let windows = ref as? [AXUIElement], let first = windows.first {
        return first
    }
    return nil
}

func windowInfo(of window: AXUIElement) -> WindowInfo {
    var titleRef: CFTypeRef?
    AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleRef)
    let title = (titleRef as? String) ?? ""

    var posRef: CFTypeRef?
    AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &posRef)
    var sizeRef: CFTypeRef?
    AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeRef)

    var bounds: [Double] = [0, 0, 0, 0]
    if let posValue = posRef {
        var point = CGPoint.zero
        AXValueGetValue(posValue as! AXValue, .cgPoint, &point)
        bounds[0] = Double(point.x); bounds[1] = Double(point.y)
    }
    if let sizeValue = sizeRef {
        var size = CGSize.zero
        AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
        bounds[2] = Double(size.width); bounds[3] = Double(size.height)
    }
    return WindowInfo(id: 0, title: title, bounds: bounds)
}

// ─── Snapshot (focused-window scoped) ─────────────────────

func snapshotFocusedWindow(pid: pid_t) -> Result<FocusedSnapshotResult, AXBridgeError> {
    let app = AXUIElementCreateApplication(pid)

    // Permission / access preflight — mirror snapshotApp's apiDisabled handling.
    var roleRef: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(app, kAXRoleAttribute as CFString, &roleRef)
    guard result == .success else {
        if result == .apiDisabled {
            return .failure(AXBridgeError(message: "Accessibility permission not granted. Open System Settings → Privacy & Security → Accessibility and add Terminal (or your IDE)."))
        }
        return .failure(AXBridgeError(message: "Cannot access app (PID \(pid)). Error: \(result.rawValue)"))
    }

    guard let window = focusedWindowElement(app: app) else {
        // No window is a benign, recoverable state — not a crash.
        return .success(FocusedSnapshotResult(
            window: nil, elements: [], nodeCount: 0,
            axStatus: "no-window", focusedWindowTitle: ""
        ))
    }

    // walkAXTree returns paths RELATIVE to `window` (the walk root), so act()
    // navigation below stays scoped to the focused window.
    let elements = walkAXTree(element: window)
    let info = windowInfo(of: window)
    // "empty" is the vision-fallback signal for AX-thin apps (Electron/Qt/canvas
    // report a window but no semantic subtree — kAXErrorCannotComplete class).
    let status = elements.isEmpty ? "empty" : "ok"
    return .success(FocusedSnapshotResult(
        window: info, elements: elements, nodeCount: elements.count,
        axStatus: status, focusedWindowTitle: info.title
    ))
}

// ─── Navigation + Act (scoped to focused window) ──────────

func navigateFrom(root: AXUIElement, path: [Int]) -> AXUIElement? {
    var current = root
    for index in path {
        var childrenRef: CFTypeRef?
        AXUIElementCopyAttributeValue(current, kAXChildrenAttribute as CFString, &childrenRef)
        guard let children = childrenRef as? [AXUIElement], index < children.count else {
            return nil
        }
        current = children[index]
    }
    return current
}

func computerUseAct(pid: pid_t, path: [Int], action: String, value: String?) -> Result<ActValueResult, AXBridgeError> {
    let app = AXUIElementCreateApplication(pid)
    guard let window = focusedWindowElement(app: app) else {
        return .failure(AXBridgeError(message: "No focused window for app (PID \(pid))"))
    }
    guard let element = navigateFrom(root: window, path: path) else {
        return .failure(AXBridgeError(message: "Element not found at focused-window path \(path). Re-snapshot; the window may have changed."))
    }

    switch action {
    case "press", "click":
        let r = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if r != .success {
            return .success(ActValueResult(success: false, value: nil, error: "Press failed: \(r.rawValue)"))
        }
        return .success(ActValueResult(success: true, value: nil, error: nil))

    case "setValue":
        guard let value = value else {
            return .failure(AXBridgeError(message: "setValue requires a value"))
        }
        let r = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
        // Read back for verification regardless of the set result.
        var readRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &readRef)
        let readValue = readRef.flatMap { $0 as? String }
        if r != .success {
            return .success(ActValueResult(success: false, value: readValue, error: "setValue failed: \(r.rawValue)"))
        }
        return .success(ActValueResult(success: true, value: readValue, error: nil))

    default:
        return .failure(AXBridgeError(message: "Unknown computer-use action: \(action)"))
    }
}

// ─── Key (CGEvent) ────────────────────────────────────────

func activateComputerUseTarget(pid: pid_t) {
    if let running = NSRunningApplication(processIdentifier: pid) {
        let activate = { _ = running.activate(options: []) }
        if Thread.isMainThread { activate() } else { DispatchQueue.main.sync(execute: activate) }
    }
}

private let keyCodeMap: [String: CGKeyCode] = [
    "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51,
    "escape": 53, "esc": 53, "left": 123, "right": 124, "down": 125, "up": 126,
]

func computerUseKey(pid: pid_t, key: String) -> Result<Bool, AXBridgeError> {
    guard let code = keyCodeMap[key.lowercased()] else {
        return .failure(AXBridgeError(message: "Unsupported key '\(key)'. Supported: \(keyCodeMap.keys.sorted().joined(separator: ", "))"))
    }
    // Bring the target app frontmost so the key lands in the focused window.
    activateComputerUseTarget(pid: pid)
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
        return .failure(AXBridgeError(message: "Failed to create key event"))
    }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    return .success(true)
}

func computerUseClickAt(pid: pid_t, x: Double, y: Double) -> Result<Bool, AXBridgeError> {
    activateComputerUseTarget(pid: pid)
    let point = CGPoint(x: x, y: y)
    guard let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left),
          let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
          let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {
        return .failure(AXBridgeError(message: "Failed to create mouse events"))
    }
    move.post(tap: .cghidEventTap)
    down.post(tap: .cghidEventTap)
    usleep(20_000)
    up.post(tap: .cghidEventTap)
    return .success(true)
}

func computerUseTypeText(pid: pid_t, text: String) -> Result<Bool, AXBridgeError> {
    activateComputerUseTarget(pid: pid)
    let units = Array(text.utf16)
    if units.isEmpty { return .success(true) }

    func postTextEvent(keyDown: Bool) -> Bool {
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: keyDown) else {
            return false
        }
        units.withUnsafeBufferPointer { buffer in
            if let base = buffer.baseAddress {
                event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: base)
            }
        }
        event.post(tap: .cghidEventTap)
        return true
    }

    guard postTextEvent(keyDown: true), postTextEvent(keyDown: false) else {
        return .failure(AXBridgeError(message: "Failed to create text events"))
    }
    return .success(true)
}

func computerUsePreflight() -> PreflightResult {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): false] as CFDictionary
    return PreflightResult(trusted: AXIsProcessTrustedWithOptions(options))
}
