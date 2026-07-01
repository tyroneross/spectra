// native/swift/window-bounds/WindowBounds.swift
//
// Tiny CLI that reports the on-screen bounds of a focal window, for the
// pipeline's auto-focal-window spotlight (src/pipeline/window-focus.ts).
// Deliberately built on CGWindowListCopyWindowInfo rather than the
// Accessibility API — it never touches an AXUIElement, has no TCC
// Accessibility-permission dependency, and stays independent of
// native/swift/AXBridge.swift. Screen Recording permission is the only
// prerequisite (same grant Spectra's capture path already needs) since
// window *names* require it; bounds/ownership alone do not.
//
// Usage:
//   spectra-window-bounds [--app <substr>] [--title <substr>]
//                         [--screen-w <px>] [--screen-h <px>]
//
// With no --app/--title, reports the frontmost application's topmost
// on-screen window. With --app and/or --title, reports the topmost
// on-screen window whose owner name / window title contains the given
// substring (case-insensitive).
//
// Prints one JSON object to stdout and exits 0 on success:
//   {"x":.., "y":.., "w":.., "h":.., "normalized":bool, "screenW":.., "screenH":.., "app":"..", "title":".."}
//
// When --screen-w/--screen-h are supplied, x/y/w/h are normalized to 0..1
// against that screen size (normalized:true, screenW/screenH echo the
// inputs). Otherwise x/y/w/h are absolute points in the window's screen's
// coordinate space (normalized:false, screenW/screenH report that screen's
// full size so callers can rescale against a differently-sized canvas).
//
// Exit codes: 0 success, 64 bad arguments, 65 no matching window found,
// 70 unexpected failure reading the window list.

import AppKit
import CoreGraphics
import Foundation

// MARK: - CLI args

struct Options {
    var app: String?
    var title: String?
    var screenW: Double?
    var screenH: Double?
}

enum CliError: Error, CustomStringConvertible {
    case missingValue(String)
    case invalidValue(String)
    case unknownArgument(String)

    var description: String {
        switch self {
        case .missingValue(let flag): return "missing value for \(flag)"
        case .invalidValue(let flag): return "invalid value for \(flag)"
        case .unknownArgument(let arg): return "unknown argument \(arg)"
        }
    }
}

func parseOptions(_ args: [String]) throws -> Options {
    var options = Options()
    var index = 0
    while index < args.count {
        let arg = args[index]
        switch arg {
        case "--app":
            guard index + 1 < args.count else { throw CliError.missingValue(arg) }
            options.app = args[index + 1]
            index += 2
        case "--title":
            guard index + 1 < args.count else { throw CliError.missingValue(arg) }
            options.title = args[index + 1]
            index += 2
        case "--screen-w":
            guard index + 1 < args.count else { throw CliError.missingValue(arg) }
            guard let value = Double(args[index + 1]), value.isFinite, value > 0 else {
                throw CliError.invalidValue(arg)
            }
            options.screenW = value
            index += 2
        case "--screen-h":
            guard index + 1 < args.count else { throw CliError.missingValue(arg) }
            guard let value = Double(args[index + 1]), value.isFinite, value > 0 else {
                throw CliError.invalidValue(arg)
            }
            options.screenH = value
            index += 2
        default:
            throw CliError.unknownArgument(arg)
        }
    }
    return options
}

// MARK: - Window info

/// Owner names that show up in the on-screen window list but are never a
/// meaningful capture focus (menu bar, wallpaper, system chrome).
let ownerExclusionList: Set<String> = [
    "Window Server",
    "Dock",
    "Control Center",
    "Spotlight",
    "NotificationCenter",
    "NowPlayingTouchUI",
    "SystemUIServer",
    "WallpaperAgent",
    "loginwindow",
]

/// Windows smaller than this in either dimension are treated as chrome
/// (menu extras, tooltips, invisible helper windows) rather than a
/// real focal window.
let minimumWindowDimension: CGFloat = 40

struct WindowEntry {
    let ownerName: String
    let windowName: String
    let pid: Int32
    let layer: Int
    let bounds: CGRect
}

func onScreenWindows() -> [WindowEntry] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: AnyObject]] else {
        return []
    }
    return list.compactMap { info -> WindowEntry? in
        guard let boundsDict = info[kCGWindowBounds as String] as? [String: AnyObject] else { return nil }
        let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) ?? .zero
        guard bounds.width >= minimumWindowDimension, bounds.height >= minimumWindowDimension else { return nil }
        let ownerName = (info[kCGWindowOwnerName as String] as? String) ?? ""
        let windowName = (info[kCGWindowName as String] as? String) ?? ""
        let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? -1
        let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
        return WindowEntry(ownerName: ownerName, windowName: windowName, pid: pid, layer: layer, bounds: bounds)
    }
}

func contains(_ haystack: String, _ needle: String) -> Bool {
    haystack.range(of: needle, options: [.caseInsensitive]) != nil
}

/// Picks the focal window: filtered by --app/--title when given (topmost
/// match, since CGWindowListCopyWindowInfo returns front-to-back order),
/// otherwise the frontmost application's topmost regular window.
func selectFocalWindow(_ windows: [WindowEntry], options: Options) -> WindowEntry? {
    let regularWindows = windows.filter { $0.layer == 0 && !ownerExclusionList.contains($0.ownerName) }

    if options.app != nil || options.title != nil {
        return regularWindows.first { entry in
            let appMatches = options.app.map { contains(entry.ownerName, $0) } ?? true
            let titleMatches = options.title.map { contains(entry.windowName, $0) } ?? true
            return appMatches && titleMatches
        }
    }

    if let frontmostPid = NSWorkspace.shared.frontmostApplication?.processIdentifier {
        if let match = regularWindows.first(where: { $0.pid == frontmostPid }) {
            return match
        }
    }

    // No frontmost-app match (e.g. running headless / no GUI session):
    // fall back to the topmost regular window in front-to-back order.
    return regularWindows.first
}

// MARK: - Output

func emit(_ object: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data("spectra-window-bounds: \(message)\n".utf8))
    exit(code)
}

func screenSize(for windowBounds: CGRect) -> CGSize {
    // Match the window to the screen it's (mostly) on; fall back to the main
    // screen, and finally to the window's own bounds if no screen is found
    // (shouldn't happen with a real display, but keeps this pure/total).
    let containingScreen = NSScreen.screens.first { $0.frame.intersects(windowBounds) }
    return (containingScreen ?? NSScreen.main)?.frame.size ?? windowBounds.size
}

func run() -> Int32 {
    let options: Options
    do {
        options = try parseOptions(Array(CommandLine.arguments.dropFirst()))
    } catch {
        fail("\(error)", code: 64)
    }

    let windows = onScreenWindows()
    guard let focal = selectFocalWindow(windows, options: options) else {
        fail("no matching window found", code: 65)
    }

    let resolvedScreen = screenSize(for: focal.bounds)
    let screenW = options.screenW ?? Double(resolvedScreen.width)
    let screenH = options.screenH ?? Double(resolvedScreen.height)
    let normalized = options.screenW != nil && options.screenH != nil

    var payload: [String: Any] = [
        "app": focal.ownerName,
        "title": focal.windowName,
        "screenW": screenW,
        "screenH": screenH,
        "normalized": normalized,
    ]

    if normalized, screenW > 0, screenH > 0 {
        payload["x"] = Double(focal.bounds.minX) / screenW
        payload["y"] = Double(focal.bounds.minY) / screenH
        payload["w"] = Double(focal.bounds.width) / screenW
        payload["h"] = Double(focal.bounds.height) / screenH
    } else {
        payload["x"] = Double(focal.bounds.minX)
        payload["y"] = Double(focal.bounds.minY)
        payload["w"] = Double(focal.bounds.width)
        payload["h"] = Double(focal.bounds.height)
    }

    emit(payload)
    return 0
}

exit(run())
