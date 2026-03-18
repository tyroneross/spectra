// native/swift/AppTarget.swift
import Foundation
import AppKit

struct AppInfo {
    let pid: pid_t
    let name: String
    let bundleIdentifier: String?
}

enum AppTargetError: Error {
    case missingParams
    case appNotRunning(String)
    case invalidParams

    var message: String {
        switch self {
        case .missingParams:
            return "Missing params"
        case .appNotRunning(let name):
            return "App not running: \(name). Launch it first."
        case .invalidParams:
            return "Provide 'app' (name) or 'pid' (number)"
        }
    }
}

func findApp(name: String) -> AppInfo? {
    // NSWorkspace must be accessed on main thread
    var result: AppInfo? = nil
    if Thread.isMainThread {
        result = findAppSync(name: name)
    } else {
        DispatchQueue.main.sync {
            result = findAppSync(name: name)
        }
    }
    return result
}

func findAppSync(name: String) -> AppInfo? {
    let apps = NSWorkspace.shared.runningApplications
    // Try exact match first (case-insensitive)
    if let app = apps.first(where: { $0.localizedName?.lowercased() == name.lowercased() }) {
        return AppInfo(
            pid: app.processIdentifier,
            name: app.localizedName ?? name,
            bundleIdentifier: app.bundleIdentifier
        )
    }
    // Try contains match
    if let app = apps.first(where: { $0.localizedName?.lowercased().contains(name.lowercased()) == true }) {
        return AppInfo(
            pid: app.processIdentifier,
            name: app.localizedName ?? name,
            bundleIdentifier: app.bundleIdentifier
        )
    }
    return nil
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
        guard let app = findApp(name: name) else {
            return .failure(.appNotRunning(name))
        }
        return .success(app.pid)
    }

    return .failure(.invalidParams)
}
