// macos/Spectra/DaemonCore/PermissionOps.swift
// M3.G1 — permission/window control-plane ops (permissions group): getPermissions,
// requestPermissions, listWindows. These use native macOS APIs (TCC status via
// AXIsProcessTrusted/CGPreflightScreenCaptureAccess, CGWindowListCopyWindowInfo) —
// EASIER in Swift than the TS shell-out (osascript / preflight helper binary).
// getPermissions/requestPermissions read status only (no capture, no GUI prompt
// in this headless daemon); listWindows enumerates on-screen windows.
//
// Mirrors src/daemon/core-impl.ts (getPermissions/requestPermissions/listWindows,
// getPermissionStatuses/probePermission/permissionStatus/settingsUrl,
// listMacWindows) and src/contract/core-api.ts (PermissionsResult,
// RequestPermissionsResult, ListWindowsResult, PermissionStatus, WindowRecord).
// SPDX-License-Identifier: Apache-2.0
import Foundation
import ApplicationServices
import CoreGraphics
import AppKit

// ─── PermissionKind / PermissionState (src/contract/core-api.ts literal unions) ──
// PermissionKind = accessibility | screen-recording | automation | developer-tools
// PermissionState = granted | denied | not-determined | restricted | unsupported | unknown
// The oracle validates these as exact string literals — do not invent new values.

private let allPermissionKinds = ["accessibility", "screen-recording", "automation", "developer-tools"]

private let requiredForByKind: [String: [String]] = [
    "accessibility": ["macOS UI snapshots", "macOS UI actions"],
    "screen-recording": ["screenshots", "video capture"],
    "automation": ["opening System Settings", "controlling helper applications"],
    "developer-tools": ["web CDP debugging"],
]

private func settingsUrl(for kind: String) -> String? {
    switch kind {
    case "accessibility": return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    case "screen-recording": return "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
    case "automation": return "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
    case "developer-tools": return "x-apple.systempreferences:com.apple.preference.security?Privacy_DeveloperTools"
    default: return nil
    }
}

/// Probe the real TCC state for a permission kind. accessibility and
/// screen-recording have cheap, non-prompting native probes
/// (AXIsProcessTrusted / CGPreflightScreenCaptureAccess). macOS exposes no
/// public, non-prompting, daemon-safe probe for Automation or Developer Tools
/// consent — report "not-determined" rather than fabricating "granted"
/// (matches the TS daemon's honesty stance in core-impl.ts probePermission,
/// which likewise refuses to guess for these two kinds).
private func probePermission(_ kind: String) -> String {
    switch kind {
    case "accessibility":
        return AXIsProcessTrusted() ? "granted" : "denied"
    case "screen-recording":
        return CGPreflightScreenCaptureAccess() ? "granted" : "denied"
    case "automation", "developer-tools":
        // macOS has no public, non-prompting, daemon-safe probe for these two —
        // the TS daemon reports "unknown" (core-impl.ts), NOT "not-determined".
        return "unknown"
    default:
        return "unsupported"
    }
}

private func permissionStatus(_ kind: String, now: Int) -> [String: Any] {
    let state = probePermission(kind)
    var dict: [String: Any] = [
        "permission": kind,
        "state": state,
        "requiredFor": requiredForByKind[kind] ?? [],
        // canPrompt: the TS daemon reports `true` on darwin regardless of state
        // (the settings pane can always be opened) — match that, not a
        // state-dependent guess.
        "canPrompt": true,
        "lastCheckedAt": now,
    ]
    if let url = settingsUrl(for: kind) { dict["settingsUrl"] = url }
    return dict
}

/// Real per-kind TCC status list. Non-private so the health op can honor
/// `includePermissions` from the same source of truth.
func permissionStatuses(filter: [String]?) -> [[String: Any]] {
    let kinds = filter ?? allPermissionKinds
    let now = JSON.nowMillis()
    return kinds.map { permissionStatus($0, now: now) }
}

private func parsePermissionsFilter(_ params: Any?) -> [String]? {
    guard let obj = params as? [String: Any], let raw = obj["permissions"] as? [Any] else { return nil }
    return raw.compactMap { $0 as? String }
}

// ─── WindowRecord (src/contract/core-api.ts) ──────────────────────────────────
// windowId, appName, bundleIdentifier?, processId, title, x, y, width, height,
// onScreen, active?, layer.

private func listMacWindows() -> [[String: Any]] {
    guard let list = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
    ) as? [[String: Any]] else {
        return []
    }
    return list.compactMap { info -> [String: Any]? in
        guard let windowId = info[kCGWindowNumber as String] as? Int,
              let ownerName = info[kCGWindowOwnerName as String] as? String,
              let pid = info[kCGWindowOwnerPID as String] as? Int,
              let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
        else { return nil }

        let title = info[kCGWindowName as String] as? String ?? ""
        let onScreen = (info[kCGWindowIsOnscreen as String] as? Bool) ?? true
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        let bundleId = NSRunningApplication(processIdentifier: pid_t(pid))?.bundleIdentifier ?? ""

        return [
            "windowId": windowId,
            "appName": ownerName,
            "bundleIdentifier": bundleId,
            "processId": pid,
            "title": title,
            "x": Int(bounds.origin.x),
            "y": Int(bounds.origin.y),
            "width": Int(bounds.size.width),
            "height": Int(bounds.size.height),
            "onScreen": onScreen,
            "layer": layer,
        ] as [String: Any]
    }
}

/// Mirrors core-impl.ts listWindows filter logic: onScreenOnly defaults true
/// (only an explicit `false` disables it), app matches appName OR
/// bundleIdentifier (case-insensitive substring), title is a case-insensitive
/// substring match.
private func matchesWindowFilter(_ window: [String: Any], app: String?, title: String?, onScreenOnly: Bool) -> Bool {
    if onScreenOnly, (window["onScreen"] as? Bool) != true { return false }
    if let app {
        let appName = (window["appName"] as? String ?? "").lowercased()
        let bundle = (window["bundleIdentifier"] as? String ?? "").lowercased()
        if !appName.contains(app), !bundle.contains(app) { return false }
    }
    if let title {
        let windowTitle = (window["title"] as? String ?? "").lowercased()
        if !windowTitle.contains(title) { return false }
    }
    return true
}

// ─── op registration ──────────────────────────────────────────────────────────

func registerPermissionOps(_ registry: HandlerRegistry) {
    registry.register("getPermissions", capabilities: [.permissionsRead]) { params, _ in
        let filter = parsePermissionsFilter(params)
        return ["permissions": permissionStatuses(filter: filter)] as [String: Any]
    }

    registry.register("requestPermissions", capabilities: [.permissionsRequest]) { params, _ in
        // The contract's `permissions` array has no .nonempty() constraint — the
        // TS daemon accepts [] and returns {permissions:[], requested:[]}. Do the
        // same (don't invent a constraint). A non-array `permissions` is a genuine
        // shape error, but absent/[] is valid.
        let raw = (params as? [String: Any])?["permissions"] as? [Any] ?? []
        let requested = raw.compactMap { $0 as? String }
        // Headless daemon: never pop a GUI consent prompt. Mirror the TS
        // daemon's result shape by returning the real (un-prompted) TCC
        // status for exactly the requested kinds, plus the echoed request.
        return [
            "permissions": permissionStatuses(filter: requested),
            "requested": requested,
        ] as [String: Any]
    }

    registry.register("listWindows", capabilities: [.windowsRead]) { params, _ in
        let obj = params as? [String: Any]
        let app = (obj?["app"] as? String)?.lowercased()
        let title = (obj?["title"] as? String)?.lowercased()
        let onScreenOnly = (obj?["onScreenOnly"] as? Bool) != false
        let windows = listMacWindows().filter {
            matchesWindowFilter($0, app: app, title: title, onScreenOnly: onScreenOnly)
        }
        return ["windows": windows] as [String: Any]
    }
}
