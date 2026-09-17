// native/swift/PermissionHelp.swift
//
// macOS privacy (TCC) charges a permission to the process's *responsible*
// process, not to the helper binary itself. A helper spawned as a plain child
// of a terminal/IDE session is charged to that terminal app; one started by
// Spectra's LaunchAgent is charged to Spectra. Naming the actual grantee turns
// "add Terminal (or your IDE)" guesswork into one precise instruction.
import AppKit
import Darwin
import Foundation

struct ResponsibleApp: Equatable {
    let pid: pid_t
    let name: String
    let bundlePath: String?
    var executablePath: String? = nil
    var isSelf = false
}

private typealias ResponsibilityFn = @convention(c) (pid_t) -> pid_t

/// The process macOS holds responsible for `pid`, or nil when the lookup is
/// unavailable. `responsibility_get_pid_responsible_for_pid` is exported by
/// libSystem but not declared in public headers, so it is resolved at runtime
/// and degrades to nil instead of failing to link.
func responsibleApp(for pid: pid_t = getpid()) -> ResponsibleApp? {
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") else {
        return nil
    }
    let responsible = unsafeBitCast(symbol, to: ResponsibilityFn.self)(pid)
    guard responsible > 0 else { return nil }

    var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
    let length = proc_pidpath(responsible, &buffer, UInt32(buffer.count))
    let executable = length > 0 ? String(cString: buffer) : nil
    let bundlePath = executable.flatMap(appBundlePath(containing:))
    let running = NSRunningApplication(processIdentifier: responsible)
    let name = running?.localizedName
        ?? bundlePath.map { URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent }
        ?? executable.map { URL(fileURLWithPath: $0).lastPathComponent }
    guard let name else { return nil }
    return ResponsibleApp(pid: responsible, name: name, bundlePath: running?.bundleURL?.path ?? bundlePath,
                          executablePath: executable, isSelf: responsible == pid)
}

/// Outermost `.app` directory on an executable path (helpers nest inside
/// `Outer.app/Contents/Helpers`, and the outer bundle is what Settings lists).
func appBundlePath(containing executable: String) -> String? {
    let parts = executable.split(separator: "/", omittingEmptySubsequences: false)
    guard let index = parts.firstIndex(where: { $0.hasSuffix(".app") }) else { return nil }
    return parts[...index].joined(separator: "/")
}

/// Keeps the historical "Accessibility permission not granted" prefix, which
/// callers and tests match on.
func accessibilityDeniedMessage(grantee: ResponsibleApp? = responsibleApp()) -> String {
    let prefix = "Accessibility permission not granted."
    let settings = "System Settings → Privacy & Security → Accessibility"
    guard let grantee else {
        return "\(prefix) Turn on the app that started Spectra (usually your terminal or IDE) in \(settings), then retry."
    }
    let role = grantee.isSelf ? "this Spectra helper itself" : "the process that started this Spectra helper"
    if let bundle = grantee.bundlePath {
        return "\(prefix) macOS checks \(grantee.name) (\(bundle)), \(role). Turn on \(grantee.name) in \(settings), then retry."
    }
    let path = grantee.executablePath ?? grantee.name
    return "\(prefix) macOS checks \(path), \(role). It is not an app bundle, so add it with + in \(settings), then retry."
}
