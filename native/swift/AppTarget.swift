// native/swift/AppTarget.swift
import Foundation
import AppKit

struct AppInfo {
    let pid: pid_t
    let name: String
    let bundleIdentifier: String?
    var bundlePath: String? = nil
}

enum AppTargetError: Error {
    case missingParams
    case appNotRunning(String)
    case ambiguousApp(String, [AppInfo])
    case invalidParams

    var message: String {
        switch self {
        case .missingParams:
            return "Missing params"
        case .appNotRunning(let name):
            return "App not running: \(name). Launch it first."
        case .ambiguousApp(let name, let matches):
            let list = matches.map { "pid \($0.pid) (\($0.bundlePath ?? $0.bundleIdentifier ?? $0.name))" }
                .joined(separator: ", ")
            return "\(matches.count) running apps match \"\(name)\": \(list). Pass pid (or target \"pid:<n>\") to choose one."
        case .invalidParams:
            return "Provide 'app' (name) or 'pid' (number)"
        }
    }
}

/// Exact (case-insensitive) name matches win; otherwise substring matches.
/// More than one match in the winning tier is ambiguous: returning the first
/// would silently bind a session to an arbitrary instance (e.g. an isolated
/// dev build running beside the installed copy).
func matchApps(name: String, in apps: [AppInfo]) -> Result<AppInfo, AppTargetError> {
    let needle = name.lowercased()
    let exact = apps.filter { $0.name.lowercased() == needle }
    let tier = exact.isEmpty ? apps.filter { $0.name.lowercased().contains(needle) } : exact
    switch tier.count {
    case 0: return .failure(.appNotRunning(name))
    case 1: return .success(tier[0])
    default: return .failure(.ambiguousApp(name, tier))
    }
}

func findApp(name: String) -> Result<AppInfo, AppTargetError> {
    // NSWorkspace must be accessed on main thread
    let read = {
        NSWorkspace.shared.runningApplications.compactMap { app -> AppInfo? in
            guard let localized = app.localizedName else { return nil }
            return AppInfo(pid: app.processIdentifier, name: localized,
                           bundleIdentifier: app.bundleIdentifier, bundlePath: app.bundleURL?.path)
        }
    }
    let apps = Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)
    return matchApps(name: name, in: apps)
}

func getAppPid(from params: [String: AnyCodableValue]?) -> Result<pid_t, AppTargetError> {
    guard let params = params else {
        return .failure(.missingParams)
    }

    // Direct PID
    if let pid = params["pid"]?.intValue {
        return .success(pid_t(pid))
    }

    // App name lookup
    if let name = params["app"]?.stringValue {
        return findApp(name: name).map(\.pid)
    }

    return .failure(.invalidParams)
}
