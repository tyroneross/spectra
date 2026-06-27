import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import CoreVideo
import CoreGraphics
import AppKit
import Darwin

struct CLIError: Error, CustomStringConvertible {
    let description: String
}

struct WindowRecord: Encodable {
    let windowId: UInt32
    let appName: String
    let bundleIdentifier: String?
    let processId: Int32
    let title: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let onScreen: Bool
    let active: Bool?
    let layer: Int
}

struct CaptureStats: Encodable {
    let path: String
    let frames: Int
    let sourceFrames: Int
    let width: Int
    let height: Int
    let status: String
    let hardStop: Bool
    let streamError: String?
}

struct ValidationResult: Encodable {
    let verdict: String
    let targetFps: Int
    let effectiveFps: Double
    let maxGap: Double
    let cfr: Bool
    let duplicateRatio: Double
    let frames: Int
}

struct CompositeResult: Encodable {
    let output: String
    let left: CaptureStats
    let right: CaptureStats
    let leftWindow: WindowRecord
    let rightWindow: WindowRecord
    let filterComplex: String
    let labelMode: String
    let validation: ValidationResult?
}

struct Options {
    var listWindows = false
    var appA: String?
    var titleA: String?
    var labelA: String?
    var appB: String?
    var titleB: String?
    var labelB: String?
    var out: String?
    var validateFile: String?
    var duration: Double = 5
    var fps: Int = 60
    var pixFmt = "yuv420p"
    var focus = false
    var validate = true
    var keepParts = false
    // P2 — smoothed cursor
    var cursor = true
    var cursorSmoothMs: Double = 90
    // P3 — marketing finish
    var spotlight = "none"   // none | a | b
    var maxWidth = 1600
    var crf = 20
}

@main
@MainActor
struct SpectraCompositeCapture {
    static func main() async {
        do {
            let app = NSApplication.shared
            app.setActivationPolicy(.prohibited)

            let options = try parseOptions(CommandLine.arguments)

            if CommandLine.arguments.contains("--help") || CommandLine.arguments.contains("-h") {
                printUsage()
                return
            }

            if let validateFile = options.validateFile {
                let url = URL(fileURLWithPath: validateFile).standardizedFileURL
                try printJSON(try validateVideo(url, targetFps: options.fps))
                return
            }

            let processWatchdog = ProcessWatchdog(
                timeoutSeconds: processWatchdogSeconds(for: options),
                label: options.listWindows ? "list-windows" : "capture"
            )
            processWatchdog.start()
            defer { processWatchdog.cancel() }

            let content = try await currentShareableContent(
                timeoutSeconds: options.listWindows ? 15 : min(15, options.duration + 5)
            )
            let windows = content.windows.map(windowRecord).sorted {
                if $0.appName != $1.appName { return $0.appName < $1.appName }
                return $0.title < $1.title
            }

            if options.listWindows {
                try printJSON(["windows": windows])
                return
            }

            let appA = try required(options.appA, "--app-a")
            let appB = try required(options.appB, "--app-b")
            let out = try required(options.out, "--out")
            let outputURL = URL(fileURLWithPath: out).standardizedFileURL

            let leftWindow = try selectWindow(content.windows, app: appA, title: options.titleA)
            let rightWindow = try selectWindow(content.windows, app: appB, title: options.titleB)

            let tempDir = FileManager.default.temporaryDirectory
                .appendingPathComponent("spectra-composite-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

            let leftURL = tempDir.appendingPathComponent("left.mp4")
            let rightURL = tempDir.appendingPathComponent("right.mp4")

            let leftRecorder = WindowRecorder(
                window: leftWindow,
                displays: content.displays,
                outputURL: leftURL,
                fps: options.fps
            )
            let rightRecorder = WindowRecorder(
                window: rightWindow,
                displays: content.displays,
                outputURL: rightURL,
                fps: options.fps
            )
            let hardStop = CaptureHardStop(duration: options.duration, buffer: 5)
            hardStop.start {
                Task { @MainActor in
                    fputs("spectra-composite-capture: capture hard deadline fired after \(hardStop.limitSeconds)s; forcing ScreenCaptureKit streams to stop\n", stderr)
                    leftRecorder.forceStop(reason: "hard_deadline")
                    rightRecorder.forceStop(reason: "hard_deadline")
                }
            }

            // P2 — sample the global cursor for the full recording window.
            let cursorTracker: CursorTracker? = options.cursor ? CursorTracker() : nil
            cursorTracker?.start()

            async let leftStats = leftRecorder.record(duration: options.duration, hardStop: hardStop)
            async let rightStats = rightRecorder.record(duration: options.duration, hardStop: hardStop)
            let (left, right) = try await (leftStats, rightStats)
            hardStop.cancel()

            cursorTracker?.stop()

            // P2 — build the composite geometry and render a smoothed cursor layer.
            // Both panes scale to a common height preserving aspect (same as the stitch),
            // so cursor mapping is exact.
            let paneH = max(2, min(left.height, right.height) - (min(left.height, right.height) % 2))
            // nearest-even width to match ffmpeg `scale=-2:H` rounding.
            let leftPaneW = max(2, 2 * Int((Double(left.width) * Double(paneH) / Double(left.height) / 2.0).rounded()))
            let rightPaneW = max(2, 2 * Int((Double(right.width) * Double(paneH) / Double(right.height) / 2.0).rounded()))
            var cursorLayerURL: URL? = nil
            if let tracker = cursorTracker {
                let layout = PaneLayout(
                    leftWindowFrame: leftWindow.frame,
                    rightWindowFrame: rightWindow.frame,
                    leftPaneW: leftPaneW,
                    rightPaneW: rightPaneW,
                    paneH: paneH
                )
                let layerURL = tempDir.appendingPathComponent("cursor.mov")
                let ok = (try? renderCursorLayer(
                    track: tracker.collected(),
                    layout: layout,
                    fps: options.fps,
                    duration: options.duration,
                    smoothTime: options.cursorSmoothMs / 1000.0,
                    output: layerURL
                )) ?? false
                if ok { cursorLayerURL = layerURL }
            }

            let labelA = options.labelA ?? labelFor(window: leftWindow, fallbackApp: appA)
            let labelB = options.labelB ?? labelFor(window: rightWindow, fallbackApp: appB)
            let stitch = try stitchVideos(
                left: leftURL,
                right: rightURL,
                output: outputURL,
                leftLabel: labelA,
                rightLabel: labelB,
                leftHeight: left.height,
                rightHeight: right.height,
                fps: options.fps,
                pixFmt: options.pixFmt,
                focus: options.focus,
                spotlight: options.spotlight,
                cursorLayer: cursorLayerURL,
                maxWidth: options.maxWidth,
                crf: options.crf,
                tempDir: tempDir,
                duration: options.duration
            )

            let validation = options.validate
                ? try validateVideo(outputURL, targetFps: options.fps)
                : nil

            if !options.keepParts {
                try? FileManager.default.removeItem(at: tempDir)
            }

            let result = CompositeResult(
                output: outputURL.path,
                left: left,
                right: right,
                leftWindow: windowRecord(leftWindow),
                rightWindow: windowRecord(rightWindow),
                filterComplex: stitch.filterComplex,
                labelMode: stitch.labelMode,
                validation: validation
            )
            try printJSON(result)
        } catch {
            fputs("spectra-composite-capture: \(error)\n", stderr)
            exit(1)
        }
    }
}

func printUsage() {
    print("""
spectra-composite-capture --app-a <name> --app-b <name> --out <path.mp4> [options]

Options:
  --list-windows              Print SCShareableContent.current windows as JSON and exit.
  --app-a <name>              App name or bundle substring for the left pane.
  --title-a <substring>       Optional window-title substring for the left pane.
  --label-a <text>            Optional label for the left pane.
  --app-b <name>              App name or bundle substring for the right pane.
  --title-b <substring>       Optional window-title substring for the right pane.
  --label-b <text>            Optional label for the right pane.
  --out <path.mp4>            Composite MP4 output path.
  --duration <seconds>        Capture duration. Default: 5.
  --fps <frames>              Capture FPS. Default: 60.
  --pixfmt <format>           Output pixel format: yuv420p or yuv444p. Default: yuv420p.
  --focus                     Apply subtle edge dim/blur vignette to each pane.
  --cursor                    Composite a smoothed cursor sprite. Default on.
  --no-cursor                 Disable the smoothed cursor.
  --cursor-smooth <ms>        Cursor easing time constant. Default: 90.
  --spotlight <a|b|none>      Dim+blur the NON-focal pane (a=left, b=right). Default: none.
  --max-width <px>            Lanczos-downscale final width to <= px. Default: 1600.
  --crf <1..51>               x264 quality (lower=better). Default: 20.
  --validate                  Run CFR validator after encode. Default.
  --validate-file <path.mp4>  Validate an existing MP4 and exit.
  --no-validate               Skip CFR validator.
  --keep-parts                Keep intermediate per-window MP4s under /tmp.
""")
}

func parseOptions(_ args: [String]) throws -> Options {
    var options = Options()
    var index = 1

    func value(after flag: String) throws -> String {
        let next = index + 1
        guard next < args.count else { throw CLIError(description: "Missing value for \(flag)") }
        index = next
        return args[next]
    }

    while index < args.count {
        let arg = args[index]
        switch arg {
        case "--list-windows":
            options.listWindows = true
        case "--app-a":
            options.appA = try value(after: arg)
        case "--title-a", "--window-title-a":
            options.titleA = try value(after: arg)
        case "--label-a":
            options.labelA = try value(after: arg)
        case "--app-b":
            options.appB = try value(after: arg)
        case "--title-b", "--window-title-b":
            options.titleB = try value(after: arg)
        case "--label-b":
            options.labelB = try value(after: arg)
        case "--out":
            options.out = try value(after: arg)
        case "--validate-file", "--validate-only":
            options.validateFile = try value(after: arg)
        case "--duration":
            let raw = try value(after: arg)
            guard let value = Double(raw), value > 0 else {
                throw CLIError(description: "--duration must be a positive number")
            }
            options.duration = value
        case "--fps":
            let raw = try value(after: arg)
            guard let value = Int(raw), value > 0 else {
                throw CLIError(description: "--fps must be a positive integer")
            }
            options.fps = value
        case "--pixfmt", "--pix-fmt":
            let raw = try value(after: arg)
            guard raw == "yuv420p" || raw == "yuv444p" else {
                throw CLIError(description: "--pixfmt must be yuv420p or yuv444p")
            }
            options.pixFmt = raw
        case "--focus":
            options.focus = true
        case "--cursor":
            options.cursor = true
        case "--no-cursor":
            options.cursor = false
        case "--cursor-smooth":
            let raw = try value(after: arg)
            guard let value = Double(raw), value >= 0 else {
                throw CLIError(description: "--cursor-smooth must be a non-negative number (ms)")
            }
            options.cursorSmoothMs = value
        case "--spotlight":
            let raw = try value(after: arg).lowercased()
            switch raw {
            case "a", "left": options.spotlight = "a"
            case "b", "right": options.spotlight = "b"
            case "none", "off": options.spotlight = "none"
            default: throw CLIError(description: "--spotlight must be a|b|none")
            }
        case "--max-width":
            let raw = try value(after: arg)
            guard let value = Int(raw), value >= 320 else {
                throw CLIError(description: "--max-width must be an integer >= 320")
            }
            options.maxWidth = value
        case "--crf":
            let raw = try value(after: arg)
            guard let value = Int(raw), value >= 1, value <= 51 else {
                throw CLIError(description: "--crf must be 1..51")
            }
            options.crf = value
        case "--validate":
            options.validate = true
        case "--no-validate":
            options.validate = false
        case "--keep-parts":
            options.keepParts = true
        case "--help", "-h":
            break
        default:
            throw CLIError(description: "Unknown argument: \(arg)")
        }
        index += 1
    }

    return options
}

func required(_ value: String?, _ flag: String) throws -> String {
    guard let value, !value.isEmpty else { throw CLIError(description: "Missing required \(flag)") }
    return value
}

func printJSON<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(value)
    guard let string = String(data: data, encoding: .utf8) else {
        throw CLIError(description: "Failed to encode JSON")
    }
    print(string)
}

func windowRecord(_ window: SCWindow) -> WindowRecord {
    WindowRecord(
        windowId: window.windowID,
        appName: window.owningApplication?.applicationName ?? "",
        bundleIdentifier: window.owningApplication?.bundleIdentifier,
        processId: window.owningApplication?.processID ?? 0,
        title: window.title ?? "",
        x: window.frame.origin.x,
        y: window.frame.origin.y,
        width: window.frame.width,
        height: window.frame.height,
        onScreen: window.isOnScreen,
        active: {
            if #available(macOS 13.1, *) { return window.isActive }
            return nil
        }(),
        layer: window.windowLayer
    )
}

func selectWindow(_ windows: [SCWindow], app: String, title: String?) throws -> SCWindow {
    let appNeedle = app.lowercased()
    let titleNeedle = title?.lowercased()

    let matches = windows.filter { window in
        let appName = window.owningApplication?.applicationName.lowercased() ?? ""
        let bundle = window.owningApplication?.bundleIdentifier.lowercased() ?? ""
        let windowTitle = (window.title ?? "").lowercased()

        let appMatches = appName.contains(appNeedle) || bundle.contains(appNeedle)
        let titleMatches = titleNeedle.map { windowTitle.contains($0) } ?? true
        return appMatches && titleMatches && isCaptureCandidate(window)
    }

    guard !matches.isEmpty else {
        let titlePart = title.map { " title containing '\($0)'" } ?? ""
        throw CLIError(description: "No ScreenCaptureKit window found for app '\(app)'\(titlePart)")
    }

    let orderedMatches = matches.sorted { lhs, rhs in
        let lhsTitled = !(lhs.title ?? "").isEmpty
        let rhsTitled = !(rhs.title ?? "").isEmpty
        if lhs.isOnScreen != rhs.isOnScreen { return lhs.isOnScreen && !rhs.isOnScreen }
        if lhsTitled != rhsTitled { return lhsTitled && !rhsTitled }
        if lhs.windowLayer != rhs.windowLayer { return lhs.windowLayer < rhs.windowLayer }
        let lhsArea = lhs.frame.width * lhs.frame.height
        let rhsArea = rhs.frame.width * rhs.frame.height
        return lhsArea > rhsArea
    }

    let selected = orderedMatches.first!
    guard selected.isOnScreen else {
        throw CLIError(description: "window \(selected.windowID) is off-screen/minimized — no frames")
    }
    return selected
}

func isCaptureCandidate(_ window: SCWindow) -> Bool {
    if window.windowLayer != 0 { return false }
    if window.frame.width < 100 || window.frame.height < 100 { return false }
    return true
}

func labelFor(window: SCWindow, fallbackApp: String) -> String {
    let app = window.owningApplication?.applicationName
    let title = window.title
    if let app, let title, !title.isEmpty { return "\(app): \(title)" }
    if let app, !app.isEmpty { return app }
    return fallbackApp
}

func processWatchdogSeconds(for options: Options) -> Double {
    if options.listWindows { return 20 }
    return options.duration + 5 + encodeTimeoutSeconds(duration: options.duration) + 20
}

final class ProcessWatchdog: @unchecked Sendable {
    private let timeoutSeconds: Double
    private let label: String
    private let lock = NSLock()
    private var timer: DispatchSourceTimer?

    init(timeoutSeconds: Double, label: String) {
        self.timeoutSeconds = timeoutSeconds
        self.label = label
    }

    func start() {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
        timer.schedule(deadline: .now() + timeoutSeconds)
        timer.setEventHandler { [timeoutSeconds, label] in
            fputs("spectra-composite-capture: hard process watchdog fired for \(label) after \(timeoutSeconds)s; exiting\n", stderr)
            fflush(stderr)
            exit(124)
        }
        lock.lock()
        self.timer = timer
        lock.unlock()
        timer.resume()
    }

    func cancel() {
        lock.lock()
        let existing = timer
        timer = nil
        lock.unlock()
        existing?.cancel()
    }
}

func currentShareableContent(timeoutSeconds: Double) async throws -> SCShareableContent {
    try await withCheckedThrowingContinuation { continuation in
        let state = ShareableContentState(continuation: continuation)
        Task {
            do {
                state.resume(.success(try await SCShareableContent.current))
            } catch {
                state.resume(.failure(error))
            }
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeoutSeconds) {
            state.resume(.failure(CLIError(description: "Timed out reading ScreenCaptureKit shareable content")))
        }
    }
}

final class ShareableContentState: @unchecked Sendable {
    private let lock = NSLock()
    private var didResume = false
    private let continuation: CheckedContinuation<SCShareableContent, Error>

    init(continuation: CheckedContinuation<SCShareableContent, Error>) {
        self.continuation = continuation
    }

    func resume(_ result: Result<SCShareableContent, Error>) {
        lock.lock()
        if didResume {
            lock.unlock()
            return
        }
        didResume = true
        lock.unlock()

        switch result {
        case .success(let value):
            continuation.resume(returning: value)
        case .failure(let error):
            continuation.resume(throwing: error)
        }
    }
}

final class CaptureHardStop: @unchecked Sendable {
    let limitSeconds: Double
    let startedAtNanos: UInt64

    private let lock = NSLock()
    private var timer: DispatchSourceTimer?
    private var fired = false

    init(duration: Double, buffer: Double) {
        self.limitSeconds = max(0.1, duration + buffer)
        self.startedAtNanos = DispatchTime.now().uptimeNanoseconds
    }

    var deadlineNanos: UInt64 {
        startedAtNanos + UInt64((limitSeconds * 1_000_000_000.0).rounded())
    }

    var isFired: Bool {
        lock.lock()
        let value = fired || DispatchTime.now().uptimeNanoseconds >= deadlineNanos
        if value { fired = true }
        lock.unlock()
        return value
    }

    var remainingNanos: UInt64 {
        let now = DispatchTime.now().uptimeNanoseconds
        if now >= deadlineNanos { return 0 }
        return deadlineNanos - now
    }

    var remainingSeconds: Double {
        Double(remainingNanos) / 1_000_000_000.0
    }

    func start(_ onFire: @escaping @Sendable () -> Void) {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
        timer.schedule(deadline: .now() + limitSeconds)
        timer.setEventHandler { [weak self] in
            guard let self, self.markFired() else { return }
            onFire()
        }
        lock.lock()
        self.timer = timer
        lock.unlock()
        timer.resume()
    }

    func cancel() {
        lock.lock()
        let existing = timer
        timer = nil
        lock.unlock()
        existing?.cancel()
    }

    private func markFired() -> Bool {
        lock.lock()
        if fired {
            lock.unlock()
            return false
        }
        fired = true
        lock.unlock()
        return true
    }
}

final class WindowRecorder: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let window: SCWindow
    private let displays: [SCDisplay]
    private let outputURL: URL
    private let fps: Int
    private let size: (width: Int, height: Int)
    private let sampleQueue = DispatchQueue(label: "spectra.composite.capture.sample")
    private let frameLock = NSLock()
    private let stateLock = NSLock()

    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var frameCount = 0
    private var sourceFrameCount = 0
    private var latestPixelBuffer: CVPixelBuffer?
    private var streamError: Error?
    private var activeStream: SCStream?
    private var forcedStopReason: String?

    init(window: SCWindow, displays: [SCDisplay], outputURL: URL, fps: Int) {
        self.window = window
        self.displays = displays
        self.outputURL = outputURL
        self.fps = fps
        self.size = outputSize(for: window, displays: displays)
    }

    @MainActor
    func record(duration: Double, hardStop: CaptureHardStop) async throws -> CaptureStats {
        try? FileManager.default.removeItem(at: outputURL)

        let timeScale = CMTimeScale(max(600, fps * 1000))
        let ticksPerFrame = CMTimeValue(timeScale / CMTimeScale(fps))
        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: size.width,
            AVVideoHeightKey: size.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: max(8_000_000, size.width * size.height * fps / 8),
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ])
        input.expectsMediaDataInRealTime = true
        input.mediaTimeScale = timeScale

        guard writer.canAdd(input) else {
            throw CLIError(description: "AVAssetWriter cannot add video input for \(outputURL.path)")
        }
        writer.add(input)

        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
                kCVPixelBufferWidthKey as String: size.width,
                kCVPixelBufferHeightKey as String: size.height,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:]
            ]
        )

        self.writer = writer
        self.input = input
        self.adaptor = adaptor

        let configuration = SCStreamConfiguration()
        configuration.width = size.width
        configuration.height = size.height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(max(fps, Int(ceil(Double(fps) * 1.1)))))
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.scalesToFit = true
        configuration.showsCursor = false
        configuration.queueDepth = 8
        if #available(macOS 14.0, *) {
            configuration.preservesAspectRatio = true
            configuration.ignoreShadowsSingleWindow = false
            configuration.shouldBeOpaque = true
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        setActiveStream(stream)
        defer { setActiveStream(nil) }
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)
        let preStartSeed = await captureSeedPixelBuffer(
            windowID: window.windowID,
            windowFrame: window.frame,
            displayScale: displayScale(for: window, displays: displays),
            filter: filter,
            configuration: configuration,
            width: size.width,
            height: size.height,
            timeoutSeconds: min(5, max(0.1, hardStop.remainingSeconds))
        )

        guard writer.startWriting() else {
            throw writer.error ?? CLIError(description: "AVAssetWriter failed to start")
        }
        writer.startSession(atSourceTime: .zero)

        try await start(stream, timeoutSeconds: min(5, max(0.1, hardStop.remainingSeconds)))
        if let preStartSeed {
            seedFrameIfEmpty(preStartSeed)
        }

        // Seed frame 0 from a one-shot screenshot so a window that is STATIC at
        // capture start still records (SCStream only delivers frames on content
        // change; the sample-and-hold loop needs a buffer to hold).
        if latestFrame() == nil {
            if let seed = await captureSeedPixelBuffer(
                windowID: window.windowID,
                windowFrame: window.frame,
                displayScale: displayScale(for: window, displays: displays),
                filter: filter,
                configuration: configuration,
                width: size.width,
                height: size.height,
                timeoutSeconds: min(5, max(0.1, hardStop.remainingSeconds))
            ) {
                seedFrameIfEmpty(seed)
            }
        }

        var firstFrame = latestFrame()
        if firstFrame == nil {
            firstFrame = await waitForFirstFrame(timeoutSeconds: min(5, max(0.1, hardStop.remainingSeconds)))
        }
        guard let firstFrame else {
            try? await stop(stream, timeoutSeconds: min(2, max(0.1, hardStop.remainingSeconds)))
            throw noFramesCapturedError(for: window)
        }

        let targetFrames = max(1, Int((duration * Double(fps)).rounded()))
        let frameIntervalNanos = UInt64((1_000_000_000.0 / Double(fps)).rounded())
        let startedAt = hardStop.startedAtNanos
        var hitHardStop = false

        for frameIndex in 0..<targetFrames {
            if Task.isCancelled {
                forceStop(reason: "cancelled")
                throw CLIError(description: "recording cancelled for \(outputURL.path)")
            }
            if hardStop.isFired {
                hitHardStop = true
                forceStop(reason: "hard_deadline")
                break
            }
            let buffer = latestFrame() ?? firstFrame
            let presentationTime = CMTime(
                value: CMTimeValue(frameIndex) * ticksPerFrame,
                timescale: timeScale
            )
            try await appendFrame(
                buffer,
                at: presentationTime,
                timeoutNanos: max(1_000_000, min(max(frameIntervalNanos, 250_000_000), hardStop.remainingNanos))
            )

            let nextDeadline = startedAt + UInt64(frameIndex + 1) * frameIntervalNanos
            let now = DispatchTime.now().uptimeNanoseconds
            if nextDeadline > now {
                try await Task.sleep(nanoseconds: min(nextDeadline - now, hardStop.remainingNanos))
            }
        }

        try? await stop(stream, timeoutSeconds: min(2, max(0.1, hardStop.remainingSeconds)))

        sampleQueue.sync {}

        if let streamError, frameCount == 0 {
            throw streamError
        }

        guard frameCount > 0 else {
            throw noFramesCapturedError(for: window)
        }

        input.markAsFinished()
        let didFinish = await finish(writer, timeoutSeconds: 10)
        guard didFinish else {
            writer.cancelWriting()
            throw CLIError(description: "Timed out finalizing AVAssetWriter for \(outputURL.path)")
        }

        if writer.status != .completed {
            throw writer.error ?? CLIError(description: "AVAssetWriter failed for \(outputURL.path)")
        }

        let stopReason = forcedStop()
        let status: String
        if hitHardStop || stopReason == "hard_deadline" {
            status = "hard_deadline"
        } else if streamError != nil {
            status = "stream_stopped"
        } else {
            status = "completed"
        }

        return CaptureStats(
            path: outputURL.path,
            frames: frameCount,
            sourceFrames: sourceFrames(),
            width: size.width,
            height: size.height,
            status: status,
            hardStop: status == "hard_deadline",
            streamError: streamError.map { String(describing: $0) }
        )
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              CMSampleBufferIsValid(sampleBuffer),
              let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }

        if !isUsableFrame(sampleBuffer) {
            return
        }

        frameLock.lock()
        latestPixelBuffer = imageBuffer
        sourceFrameCount += 1
        frameLock.unlock()
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        streamError = error
    }

    func forceStop(reason: String) {
        let stream: SCStream?
        stateLock.lock()
        if forcedStopReason == nil { forcedStopReason = reason }
        stream = activeStream
        stateLock.unlock()
        stream?.stopCapture { _ in }
    }

    private func latestFrame() -> CVPixelBuffer? {
        frameLock.lock()
        let frame = latestPixelBuffer
        frameLock.unlock()
        return frame
    }

    private func seedFrameIfEmpty(_ buffer: CVPixelBuffer) {
        frameLock.lock()
        if latestPixelBuffer == nil { latestPixelBuffer = buffer }
        frameLock.unlock()
    }

    private func sourceFrames() -> Int {
        frameLock.lock()
        let count = sourceFrameCount
        frameLock.unlock()
        return count
    }

    private func waitForFirstFrame(timeoutSeconds: Double) async -> CVPixelBuffer? {
        let deadline = Date().addingTimeInterval(timeoutSeconds)
        while Date() < deadline {
            if let frame = latestFrame() {
                return frame
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return latestFrame()
    }

    private func appendFrame(
        _ pixelBuffer: CVPixelBuffer,
        at presentationTime: CMTime,
        timeoutNanos: UInt64
    ) async throws {
        guard let input, let adaptor else {
            throw CLIError(description: "AVAssetWriter input not initialized")
        }

        let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanos
        while !input.isReadyForMoreMediaData && DispatchTime.now().uptimeNanoseconds < deadline {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        guard input.isReadyForMoreMediaData else {
            throw CLIError(description: "AVAssetWriter input was not ready before the next CFR frame deadline")
        }

        if adaptor.append(pixelBuffer, withPresentationTime: presentationTime) {
            frameCount += 1
        } else {
            throw writer?.error ?? CLIError(description: "Failed to append CFR frame")
        }
    }

    private func setActiveStream(_ stream: SCStream?) {
        stateLock.lock()
        activeStream = stream
        stateLock.unlock()
    }

    private func forcedStop() -> String? {
        stateLock.lock()
        let value = forcedStopReason
        stateLock.unlock()
        return value
    }
}

/// One-shot screenshot of a window, rendered into a fresh BGRA pixel buffer.
/// Used to seed frame 0 so static windows still capture.
func captureSeedPixelBuffer(
    windowID: UInt32,
    windowFrame: CGRect,
    displayScale: Double,
    filter: SCContentFilter,
    configuration: SCStreamConfiguration,
    width: Int,
    height: Int,
    timeoutSeconds: Double
) async -> CVPixelBuffer? {
    if #available(macOS 14.0, *) {
        if let seed = await captureSCKSeedPixelBuffer(
            filter: filter,
            configuration: configuration,
            width: width,
            height: height,
            timeoutSeconds: timeoutSeconds
        ) {
            return seed
        }
    }
    return captureScreencaptureSeedPixelBuffer(
        windowID: windowID,
        windowFrame: windowFrame,
        displayScale: displayScale,
        width: width,
        height: height
    )
}

@available(macOS 14.0, *)
func captureSCKSeedPixelBuffer(
    filter: SCContentFilter,
    configuration: SCStreamConfiguration,
    width: Int,
    height: Int,
    timeoutSeconds: Double
) async -> CVPixelBuffer? {
    await withCheckedContinuation { continuation in
        let state = SeedCaptureState(continuation: continuation)
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, _ in
            guard let image else {
                state.resume(nil)
                return
            }
            state.resume(pixelBuffer(from: image, width: width, height: height))
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeoutSeconds) {
            state.resume(nil)
        }
    }
}

final class SeedCaptureState: @unchecked Sendable {
    private let lock = NSLock()
    private var didResume = false
    private let continuation: CheckedContinuation<CVPixelBuffer?, Never>

    init(continuation: CheckedContinuation<CVPixelBuffer?, Never>) {
        self.continuation = continuation
    }

    func resume(_ value: CVPixelBuffer?) {
        lock.lock()
        if didResume {
            lock.unlock()
            return
        }
        didResume = true
        lock.unlock()
        continuation.resume(returning: value)
    }
}

func pixelBuffer(from cgImage: CGImage, width: Int, height: Int) -> CVPixelBuffer? {
    var pb: CVPixelBuffer?
    CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pb)
    guard let buffer = pb else { return nil }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height,
                              bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                              space: colorSpace, bitmapInfo: bitmapInfo) else {
        return nil
    }
    ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
    return buffer
}

func captureScreencaptureSeedPixelBuffer(
    windowID: UInt32,
    windowFrame: CGRect,
    displayScale: Double,
    width: Int,
    height: Int
) -> CVPixelBuffer? {
    let tempDir = FileManager.default.temporaryDirectory
        .appendingPathComponent("spectra-seed-\(UUID().uuidString)", isDirectory: true)
    let pngURL = tempDir.appendingPathComponent("seed.png")
    do {
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }
        try runProcess("/usr/sbin/screencapture", ["-x", pngURL.path], timeoutSeconds: 5)
        guard let image = NSImage(contentsOf: pngURL) else { return nil }
        var rect = NSRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
            return nil
        }
        let cropRect = CGRect(
            x: max(0, floor(windowFrame.origin.x * displayScale)),
            y: max(0, floor(windowFrame.origin.y * displayScale)),
            width: max(1, ceil(windowFrame.width * displayScale)),
            height: max(1, ceil(windowFrame.height * displayScale))
        ).intersection(CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height))
        guard !cropRect.isNull,
              let cropped = cgImage.cropping(to: cropRect) else {
            return nil
        }
        return pixelBuffer(from: cropped, width: width, height: height)
    } catch {
        return nil
    }
}

func noFramesCapturedError(for window: SCWindow) -> CLIError {
    if !window.isOnScreen {
        return CLIError(description: "window \(window.windowID) is off-screen/minimized — no frames")
    }
    let app = window.owningApplication?.applicationName ?? "unknown"
    return CLIError(description: "No frames captured for \(app) window \(window.windowID); verify the window is visible/on-screen and Screen Recording permission is granted")
}

func isUsableFrame(_ sampleBuffer: CMSampleBuffer) -> Bool {
    guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
          let statusRaw = attachments.first?[SCStreamFrameInfo.status] as? Int,
          let status = SCFrameStatus(rawValue: statusRaw) else {
        return true
    }

    return status == .complete || status == .idle || status == .started
}

@MainActor
func start(_ stream: SCStream, timeoutSeconds: Double = 5) async throws {
    try await waitForStreamCallback(timeoutSeconds: timeoutSeconds, timeoutError: CLIError(description: "Timed out starting ScreenCaptureKit stream")) { done in
        stream.startCapture { error in
            done(error)
        }
    }
}

@MainActor
func stop(_ stream: SCStream, timeoutSeconds: Double = 2) async throws {
    try await waitForStreamCallback(timeoutSeconds: timeoutSeconds, timeoutError: nil) { done in
        stream.stopCapture { error in
            done(error)
        }
    }
}

@MainActor
func waitForStreamCallback(
    timeoutSeconds: Double,
    timeoutError: Error?,
    _ operation: (@escaping (Error?) -> Void) -> Void
) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        let state = StreamCallbackState(continuation: continuation)
        operation { error in
            state.resume(error)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds) {
            state.resume(timeoutError)
        }
    }
}

final class StreamCallbackState: @unchecked Sendable {
    private let lock = NSLock()
    private var didResume = false
    private let continuation: CheckedContinuation<Void, Error>

    init(continuation: CheckedContinuation<Void, Error>) {
        self.continuation = continuation
    }

    func resume(_ error: Error?) {
        lock.lock()
        if didResume {
            lock.unlock()
            return
        }
        didResume = true
        lock.unlock()

        if let error {
            continuation.resume(throwing: error)
        } else {
            continuation.resume()
        }
    }
}

func finish(_ writer: AVAssetWriter, timeoutSeconds: Double) async -> Bool {
    await withCheckedContinuation { continuation in
        let state = FinishWriterState(continuation: continuation)
        writer.finishWriting {
            state.resume(true)
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeoutSeconds) {
            state.resume(false)
        }
    }
}

final class FinishWriterState: @unchecked Sendable {
    private let lock = NSLock()
    private var didResume = false
    private let continuation: CheckedContinuation<Bool, Never>

    init(continuation: CheckedContinuation<Bool, Never>) {
        self.continuation = continuation
    }

    func resume(_ value: Bool) {
        lock.lock()
        if didResume {
            lock.unlock()
            return
        }
        didResume = true
        lock.unlock()
        continuation.resume(returning: value)
    }
}

func outputSize(for window: SCWindow, displays: [SCDisplay]) -> (width: Int, height: Int) {
    let scale = displayScale(for: window, displays: displays)
    let width = even(max(2, Int(ceil(window.frame.width * scale))))
    let height = even(max(2, Int(ceil(window.frame.height * scale))))
    return (width, height)
}

func displayScale(for window: SCWindow, displays: [SCDisplay]) -> Double {
    let center = CGPoint(x: window.frame.midX, y: window.frame.midY)
    let display = displays.first { $0.frame.contains(center) } ?? displays.first
    guard let display else { return 2.0 }

    let pixelWidth = CGDisplayPixelsWide(display.displayID)
    guard display.width > 0, pixelWidth > 0 else { return 2.0 }
    return Double(pixelWidth) / Double(display.width)
}

func even(_ value: Int) -> Int {
    value % 2 == 0 ? value : value + 1
}

struct StitchResult {
    let filterComplex: String
    let labelMode: String
}

func stitchVideos(
    left: URL,
    right: URL,
    output: URL,
    leftLabel: String,
    rightLabel: String,
    leftHeight: Int,
    rightHeight: Int,
    fps: Int,
    pixFmt: String,
    focus: Bool,
    spotlight: String,
    cursorLayer: URL?,
    maxWidth: Int,
    crf: Int,
    tempDir: URL,
    duration: Double
) throws -> StitchResult {
    try? FileManager.default.removeItem(at: output)
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)

    let height = max(2, min(leftHeight, rightHeight) - (min(leftHeight, rightHeight) % 2))
    let hasDrawtext = ffmpegSupportsDrawtext()

    var arguments = ["-y", "-i", left.path, "-i", right.path]
    var inputCount = 2
    var parts: [String] = []

    // Pane prep (+ optional codex per-pane edge vignette).
    parts.append(paneSourceFilter(inputIndex: 0, output: "lp0", height: height, fps: fps, focus: focus))
    parts.append(paneSourceFilter(inputIndex: 1, output: "rp0", height: height, fps: fps, focus: focus))

    // P3 — spotlight: dim+blur the NON-focal pane to draw the eye to the active one.
    var leftPane = "lp0", rightPane = "rp0"
    if spotlight == "a" {
        parts.append("[rp0]\(dimBlurFilter())[rp1]"); rightPane = "rp1"
    } else if spotlight == "b" {
        parts.append("[lp0]\(dimBlurFilter())[lp1]"); leftPane = "lp1"
    }

    // Labels.
    let labelMode: String
    if hasDrawtext {
        parts.append("[\(leftPane)]drawtext=\(drawtext(label: leftLabel))[la]")
        parts.append("[\(rightPane)]drawtext=\(drawtext(label: rightLabel))[ra]")
        labelMode = "drawtext"
    } else {
        let leftLabelURL = tempDir.appendingPathComponent("left-label.png")
        let rightLabelURL = tempDir.appendingPathComponent("right-label.png")
        try writeLabelImage(leftLabel, to: leftLabelURL)
        try writeLabelImage(rightLabel, to: rightLabelURL)
        arguments += ["-i", leftLabelURL.path, "-i", rightLabelURL.path]
        let li = inputCount, ri = inputCount + 1
        inputCount += 2
        parts.append("[\(leftPane)][\(li):v]overlay=16:16[la]")
        parts.append("[\(rightPane)][\(ri):v]overlay=16:16[ra]")
        labelMode = "overlay-png"
    }

    // Side-by-side.
    parts.append("[la][ra]hstack=inputs=2:shortest=1,fps=\(fps)[hs]")
    var lastLabel = "hs"

    // P2 — composite the smoothed cursor layer (transparent ProRes 4444) over the stack.
    if let cursorLayer {
        arguments += ["-i", cursorLayer.path]
        let ci = inputCount; inputCount += 1
        parts.append("[\(lastLabel)][\(ci):v]overlay=0:0:format=auto[cur]")
        lastLabel = "cur"
    }

    // P3 — lanczos downscale to <= maxWidth (preserve even height), final SAR.
    parts.append("[\(lastLabel)]scale=w='min(\(maxWidth)\\,iw)':h=-2:flags=lanczos,setsar=1[v]")

    let filter = parts.joined(separator: ";")

    arguments += [
        "-filter_complex", filter,
        "-map", "[v]",
        "-an",
        "-r", "\(fps)",
        "-vsync", "cfr",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "\(crf)",
        "-pix_fmt", pixFmt,
        "-video_track_timescale", "\(max(600, fps * 1000))",
        "-movflags", "+faststart",
        output.path
    ]

    try runProcess("/usr/bin/env", ["ffmpeg"] + arguments, timeoutSeconds: encodeTimeoutSeconds(duration: duration))
    return StitchResult(filterComplex: filter, labelMode: labelMode)
}

/// P3 spotlight — uniform dim + soft blur + slight desaturation for the non-focal pane.
func dimBlurFilter() -> String {
    "gblur=sigma=8,eq=brightness=-0.12:saturation=0.72"
}

func paneSourceFilter(inputIndex: Int, output: String, height: Int, fps: Int, focus: Bool) -> String {
    let base = "\(output)base"
    let scaled = "[\(inputIndex):v]fps=\(fps),scale=-2:\(height),setsar=1"
    guard focus else {
        return "\(scaled)[\(output)]"
    }

    return "\(scaled),format=rgba[\(base)];\(focusFilter(input: base, output: output))"
}

func focusFilter(input: String, output: String) -> String {
    let sharp = "\(input)sharp"
    let fx = "\(input)fx"
    let edge = "\(input)edge"
    let alpha = "255*0.45*max(max((0.16-min(X/W,1-X/W))/0.16,0),max((0.16-min(Y/H,1-Y/H))/0.16,0))"

    return "[\(input)]split=2[\(sharp)][\(fx)];" +
        "[\(fx)]gblur=sigma=5,eq=brightness=-0.06:saturation=0.90,format=rgba," +
        "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='\(alpha)'[\(edge)];" +
        "[\(sharp)][\(edge)]overlay=format=auto[\(output)]"
}

func ffmpegSupportsDrawtext() -> Bool {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["ffmpeg", "-hide_banner", "-filters"]
    process.standardOutput = pipe
    process.standardError = Pipe()

    do {
        try process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let text = String(data: data, encoding: .utf8) ?? ""
        return text.contains("drawtext")
    } catch {
        return false
    }
}

func drawtext(label: String) -> String {
    "text='\(escapeDrawtext(label))':x=16:y=16:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.60:boxborderw=8"
}

func escapeDrawtext(_ value: String) -> String {
    var result = ""
    for character in value {
        switch character {
        case "\\":
            result += "\\\\"
        case ":":
            result += "\\:"
        case "'":
            result += "\\'"
        case "%":
            result += "\\%"
        default:
            result.append(character)
        }
    }
    return result
}

func writeLabelImage(_ text: String, to url: URL) throws {
    let font = NSFont.boldSystemFont(ofSize: 28)
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .left
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor.white,
        .paragraphStyle: paragraph
    ]
    let size = (text as NSString).size(withAttributes: attributes)
    let imageSize = NSSize(width: ceil(size.width + 32), height: ceil(size.height + 20))
    let image = NSImage(size: imageSize)

    image.lockFocus()
    NSColor.clear.setFill()
    NSRect(origin: .zero, size: imageSize).fill()
    NSColor.black.withAlphaComponent(0.65).setFill()
    NSBezierPath(roundedRect: NSRect(origin: .zero, size: imageSize), xRadius: 6, yRadius: 6).fill()
    (text as NSString).draw(at: NSPoint(x: 16, y: 10), withAttributes: attributes)
    image.unlockFocus()

    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else {
        throw CLIError(description: "Failed to create label image")
    }

    try png.write(to: url)
}

func encodeTimeoutSeconds(duration: Double) -> Double {
    max(60, duration * 6 + 30)
}

func runProcess(_ executable: String, _ arguments: [String], timeoutSeconds: Double? = nil) throws {
    let process = Process()
    let stderr = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = Pipe()
    process.standardError = stderr

    try process.run()
    try waitForProcess(process, timeoutSeconds: timeoutSeconds)

    if process.terminationStatus != 0 {
        let data = stderr.fileHandleForReading.readDataToEndOfFile()
        let message = String(data: data, encoding: .utf8) ?? "unknown error"
        throw CLIError(description: "Command failed: \(executable) \(arguments.joined(separator: " "))\n\(message)")
    }
}

func runProcessCapture(_ executable: String, _ arguments: [String], timeoutSeconds: Double? = nil) throws -> String {
    let process = Process()
    let tempDir = FileManager.default.temporaryDirectory
        .appendingPathComponent("spectra-process-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let stdoutURL = tempDir.appendingPathComponent("stdout.txt")
    let stderrURL = tempDir.appendingPathComponent("stderr.txt")
    FileManager.default.createFile(atPath: stdoutURL.path, contents: nil)
    FileManager.default.createFile(atPath: stderrURL.path, contents: nil)

    let stdout = try FileHandle(forWritingTo: stdoutURL)
    let stderr = try FileHandle(forWritingTo: stderrURL)
    defer {
        try? stdout.close()
        try? stderr.close()
    }

    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = stdout
    process.standardError = stderr

    try process.run()
    try waitForProcess(process, timeoutSeconds: timeoutSeconds)

    try? stdout.close()
    try? stderr.close()

    let outData = (try? Data(contentsOf: stdoutURL)) ?? Data()
    let errData = (try? Data(contentsOf: stderrURL)) ?? Data()
    let out = String(data: outData, encoding: .utf8) ?? ""
    let err = String(data: errData, encoding: .utf8) ?? ""

    if process.terminationStatus != 0 {
        throw CLIError(description: "Command failed: \(executable) \(arguments.joined(separator: " "))\n\(err)")
    }

    return out + err
}

func waitForProcess(_ process: Process, timeoutSeconds: Double?) throws {
    guard let timeoutSeconds else {
        process.waitUntilExit()
        return
    }

    if !process.isRunning { return }
    let state = ProcessWaitState()
    process.terminationHandler = { _ in state.leave() }
    if !process.isRunning { state.leave() }

    let result = state.wait(timeout: .now() + timeoutSeconds)
    if result == .success {
        process.terminationHandler = nil
        return
    }

    let pid = process.processIdentifier
    process.terminate()
    let terminated = state.wait(timeout: .now() + 2)
    if terminated == .timedOut {
        kill(pid, SIGKILL)
        _ = state.wait(timeout: .now() + 2)
    }
    process.terminationHandler = nil
    throw CLIError(description: "Command timed out after \(timeoutSeconds)s: \(process.executableURL?.path ?? "") \(process.arguments?.joined(separator: " ") ?? "")")
}

final class ProcessWaitState: @unchecked Sendable {
    private let group = DispatchGroup()
    private let lock = NSLock()
    private var didLeave = false

    init() {
        group.enter()
    }

    func leave() {
        lock.lock()
        if didLeave {
            lock.unlock()
            return
        }
        didLeave = true
        lock.unlock()
        group.leave()
    }

    func wait(timeout: DispatchTime) -> DispatchTimeoutResult {
        group.wait(timeout: timeout)
    }
}

func validateVideo(_ url: URL, targetFps: Int) throws -> ValidationResult {
    let probe = try runProcessCapture("/usr/bin/env", [
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "frame=pts_time,best_effort_timestamp_time,pkt_pts_time,pkt_duration_time,duration_time:stream=duration,nb_frames:format=duration",
        "-of", "json",
        url.path
    ], timeoutSeconds: 30)

    guard let data = probe.data(using: .utf8),
          let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw CLIError(description: "Validator failed to parse ffprobe JSON")
    }

    let framesJSON = object["frames"] as? [[String: Any]] ?? []
    let pts = framesJSON.compactMap { frameTime($0) }
    let frameCount = pts.count
    let expectedGap = 1.0 / Double(targetFps)
    let duration = videoDuration(object) ?? estimatedDuration(from: pts, expectedGap: expectedGap)
    let effectiveFps = duration > 0 ? Double(frameCount) / duration : 0

    let gaps = zip(pts.dropFirst(), pts).map { next, previous in next - previous }
    let maxGap = gaps.max() ?? 0
    let maxDeviation = gaps.map { abs($0 - expectedGap) }.max() ?? 0
    let cfr = frameCount > 1 && maxDeviation <= expectedGap * 0.35 && maxGap <= expectedGap * 2.0
    let duplicateRatio = estimateDuplicateRatio(url, totalFrames: frameCount)

    let pass = effectiveFps >= Double(targetFps) * 0.9 && maxGap <= expectedGap * 2.0 && cfr
    let result = ValidationResult(
        verdict: pass ? "pass" : "fail",
        targetFps: targetFps,
        effectiveFps: roundMetric(effectiveFps),
        maxGap: roundMetric(maxGap),
        cfr: cfr,
        duplicateRatio: roundMetric(duplicateRatio),
        frames: frameCount
    )

    if !pass {
        throw CLIError(description: "validation failed: effective_fps=\(result.effectiveFps), max_gap=\(result.maxGap), cfr=\(result.cfr)")
    }

    return result
}

func frameTime(_ frame: [String: Any]) -> Double? {
    for key in ["best_effort_timestamp_time", "pts_time", "pkt_pts_time"] {
        if let value = doubleValue(frame[key]) {
            return value
        }
    }
    return nil
}

func videoDuration(_ object: [String: Any]) -> Double? {
    if let format = object["format"] as? [String: Any],
       let duration = doubleValue(format["duration"]),
       duration > 0 {
        return duration
    }

    if let streams = object["streams"] as? [[String: Any]] {
        for stream in streams {
            if let duration = doubleValue(stream["duration"]), duration > 0 {
                return duration
            }
        }
    }

    return nil
}

func estimatedDuration(from pts: [Double], expectedGap: Double) -> Double {
    guard let first = pts.first, let last = pts.last else { return 0 }
    return max(0, last - first + expectedGap)
}

func doubleValue(_ value: Any?) -> Double? {
    if let value = value as? Double { return value }
    if let value = value as? NSNumber { return value.doubleValue }
    if let value = value as? String { return Double(value) }
    return nil
}

func estimateDuplicateRatio(_ url: URL, totalFrames: Int) -> Double {
    guard totalFrames > 0 else { return 0 }

    do {
        let output = try runProcessCapture("/usr/bin/env", [
            "ffmpeg",
            "-hide_banner",
            "-i", url.path,
            "-vf", "mpdecimate",
            "-an",
            "-f", "null",
            "-"
        ], timeoutSeconds: 30)
        let kept = lastFrameCount(in: output)
        guard kept > 0 else { return 0 }
        return max(0, min(1, 1.0 - (Double(kept) / Double(totalFrames))))
    } catch {
        return 0
    }
}

func lastFrameCount(in text: String) -> Int {
    var last = 0
    let pattern = #"frame=\s*([0-9]+)"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return 0 }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    for match in regex.matches(in: text, range: range) {
        guard match.numberOfRanges > 1,
              let frameRange = Range(match.range(at: 1), in: text),
              let count = Int(text[frameRange]) else {
            continue
        }
        last = count
    }
    return last
}

func roundMetric(_ value: Double) -> Double {
    (value * 1000).rounded() / 1000
}
