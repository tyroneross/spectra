import Foundation
import CoreGraphics

let settingsPath = "System Settings > Privacy & Security > Screen Recording"
let message = "Screen Recording not granted to Spectra."
let hint = "Enable Screen Recording for the signed Spectra daemon helper in \(settingsPath), then retry."

func emit(_ object: [String: Any], toStdErr: Bool = false) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    let handle = toStdErr ? FileHandle.standardError : FileHandle.standardOutput
    handle.write(data)
    handle.write(Data("\n".utf8))
}

func hasFlag(_ flag: String) -> Bool {
    CommandLine.arguments.dropFirst().contains(flag)
}

func overriddenGrant() -> Bool? {
    let raw = ProcessInfo.processInfo.environment["SPECTRA_SCREEN_RECORDING_PREFLIGHT_OVERRIDE"]?.lowercased()
    switch raw {
    case "granted", "grant", "true", "1":
        return true
    case "denied", "deny", "false", "0":
        return false
    default:
        return nil
    }
}

let shouldRequest = !hasFlag("--no-request")
var granted = overriddenGrant() ?? CGPreflightScreenCaptureAccess()

if !granted && shouldRequest && overriddenGrant() == nil {
    granted = CGRequestScreenCaptureAccess() || CGPreflightScreenCaptureAccess()
}

if granted {
    emit([
        "ok": true,
        "permission": "screen-recording",
        "granted": true,
    ])
    exit(0)
}

emit([
    "ok": false,
    "error": [
        "code": "permission_denied",
        "message": message,
        "hint": hint,
        "retryable": false,
        "details": [
            "nativeCode": "screen_recording_not_granted",
            "permission": "screen-recording",
            "settingsPath": settingsPath,
        ],
    ],
], toStdErr: false)
exit(2)
