import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

struct CursorPoint: Codable {
    let tMs: Int
    let cx: Double
    let cy: Double
}

struct CursorTelemetry: Codable {
    let durationMs: Int
    let samples: [CursorPoint]
    let clicks: [CursorPoint]
}

struct Options {
    let durationSeconds: Double
    let fps: Double
    let outputPath: String
}

enum CliError: Error, CustomStringConvertible {
    case missingValue(String)
    case invalidValue(String)
    case unknownArgument(String)
    case missingRequired

    var description: String {
        switch self {
        case .missingValue(let flag):
            return "missing value for \(flag)"
        case .invalidValue(let flag):
            return "invalid value for \(flag)"
        case .unknownArgument(let arg):
            return "unknown argument \(arg)"
        case .missingRequired:
            return "usage: CursorSampler --duration <sec> --fps <hz> --out <json>"
        }
    }
}

final class CursorSampler {
    private let screenFrame: CGRect
    private let startNs: UInt64
    private var globalMonitor: Any?
    private var eventTap: CFMachPort?
    private var eventTapSource: CFRunLoopSource?
    private var samples: [CursorPoint] = []
    private var clicks: [CursorPoint] = []
    private var lastClickTMs = -100_000
    private var leftDown = false
    private var rightDown = false
    private var otherDown = false

    init(screenFrame: CGRect) {
        self.screenFrame = screenFrame
        self.startNs = DispatchTime.now().uptimeNanoseconds
    }

    func startClickMonitoring() {
        _ = NSApplication.shared
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] _ in
            DispatchQueue.main.async {
                self?.recordClick()
            }
        }

        let mask =
            (1 << CGEventType.leftMouseDown.rawValue)
            | (1 << CGEventType.rightMouseDown.rawValue)
            | (1 << CGEventType.otherMouseDown.rawValue)
        let selfRef = Unmanaged.passUnretained(self).toOpaque()
        eventTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: CGEventMask(mask),
            callback: { _, type, event, refcon in
                guard let refcon else {
                    return Unmanaged.passUnretained(event)
                }
                let sampler = Unmanaged<CursorSampler>.fromOpaque(refcon).takeUnretainedValue()
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    if let tap = sampler.eventTap {
                        CGEvent.tapEnable(tap: tap, enable: true)
                    }
                    return Unmanaged.passUnretained(event)
                }
                if type == .leftMouseDown || type == .rightMouseDown || type == .otherMouseDown {
                    DispatchQueue.main.async {
                        sampler.recordClick()
                    }
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: selfRef
        )

        if let eventTap {
            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
            eventTapSource = source
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
            CGEvent.tapEnable(tap: eventTap, enable: true)
        }
    }

    func stopClickMonitoring() {
        if let globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
        }
        if let source = eventTapSource {
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .commonModes)
        }
        eventTapSource = nil
        eventTap = nil
        globalMonitor = nil
    }

    func sampleCursor() {
        samples.append(currentPoint())
    }

    func detectButtonTransitions() {
        let nextLeftDown = CGEventSource.buttonState(.hidSystemState, button: .left)
        let nextRightDown = CGEventSource.buttonState(.hidSystemState, button: .right)
        let nextOtherDown = CGEventSource.buttonState(.hidSystemState, button: .center)

        if (nextLeftDown && !leftDown) || (nextRightDown && !rightDown) || (nextOtherDown && !otherDown) {
            recordClick()
        }

        leftDown = nextLeftDown
        rightDown = nextRightDown
        otherDown = nextOtherDown
    }

    func telemetry() -> CursorTelemetry {
        CursorTelemetry(
            durationMs: elapsedMs(),
            samples: samples,
            clicks: clicks
        )
    }

    private func recordClick() {
        let point = currentPoint()
        if point.tMs - lastClickTMs < 50 {
            return
        }
        lastClickTMs = point.tMs
        clicks.append(point)
    }

    private func currentPoint() -> CursorPoint {
        let location = NSEvent.mouseLocation
        let cx = clamp((Double(location.x) - Double(screenFrame.minX)) / Double(screenFrame.width))
        let cyFromBottom = (Double(location.y) - Double(screenFrame.minY)) / Double(screenFrame.height)
        return CursorPoint(
            tMs: elapsedMs(),
            cx: round6(cx),
            cy: round6(1.0 - clamp(cyFromBottom))
        )
    }

    private func elapsedMs() -> Int {
        let now = DispatchTime.now().uptimeNanoseconds
        return Int((now - startNs) / 1_000_000)
    }
}

func parseOptions(_ args: [String]) throws -> Options {
    var durationSeconds: Double?
    var fps: Double?
    var outputPath: String?
    var index = 0

    while index < args.count {
        let arg = args[index]
        switch arg {
        case "--duration":
            guard index + 1 < args.count else { throw CliError.missingValue(arg) }
            durationSeconds = Double(args[index + 1])
            if durationSeconds == nil || durationSeconds! <= 0 || !durationSeconds!.isFinite {
                throw CliError.invalidValue(arg)
            }
            index += 2
        case "--fps":
            guard index + 1 < args.count else { throw CliError.missingValue(arg) }
            fps = Double(args[index + 1])
            if fps == nil || fps! <= 0 || !fps!.isFinite {
                throw CliError.invalidValue(arg)
            }
            index += 2
        case "--out":
            guard index + 1 < args.count else { throw CliError.missingValue(arg) }
            outputPath = args[index + 1]
            index += 2
        default:
            throw CliError.unknownArgument(arg)
        }
    }

    guard let durationSeconds, let fps, let outputPath, !outputPath.isEmpty else {
        throw CliError.missingRequired
    }

    return Options(durationSeconds: durationSeconds, fps: fps, outputPath: outputPath)
}

func writeTelemetry(_ telemetry: CursorTelemetry, to path: String) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(telemetry)
    let url = URL(fileURLWithPath: path)
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try data.write(to: url, options: .atomic)
}

func main() -> Int32 {
    do {
        let options = try parseOptions(Array(CommandLine.arguments.dropFirst()))
        guard let screen = NSScreen.main else {
            fputs("CursorSampler: no main display available\n", stderr)
            return 70
        }

        let sampler = CursorSampler(screenFrame: screen.frame)
        sampler.startClickMonitoring()
        defer { sampler.stopClickMonitoring() }

        let intervalNs = UInt64((1_000_000_000.0 / options.fps).rounded())
        let startNs = DispatchTime.now().uptimeNanoseconds
        let endNs = startNs + UInt64((options.durationSeconds * 1_000_000_000.0).rounded())
        var nextSampleNs = startNs

        while DispatchTime.now().uptimeNanoseconds < endNs {
            let now = DispatchTime.now().uptimeNanoseconds
            if now >= nextSampleNs {
                sampler.sampleCursor()
                sampler.detectButtonTransitions()
                nextSampleNs += intervalNs
            }

            let nextWakeNs = min(nextSampleNs, endNs)
            let sleepSeconds = max(0.001, min(0.02, Double(nextWakeNs - now) / 1_000_000_000.0))
            RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: sleepSeconds))
        }

        sampler.sampleCursor()
        sampler.detectButtonTransitions()
        try writeTelemetry(sampler.telemetry(), to: options.outputPath)
        return 0
    } catch {
        fputs("CursorSampler: \(error)\n", stderr)
        return 64
    }
}

func clamp(_ value: Double) -> Double {
    min(1.0, max(0.0, value))
}

func round6(_ value: Double) -> Double {
    (value * 1_000_000.0).rounded() / 1_000_000.0
}

exit(main())
