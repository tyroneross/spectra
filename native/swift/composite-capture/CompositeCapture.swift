import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import CoreVideo
import CoreGraphics
import AppKit

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
    var validate = true
    var keepParts = false
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

            let content = try await SCShareableContent.current
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

            async let leftStats = leftRecorder.record(duration: options.duration)
            async let rightStats = rightRecorder.record(duration: options.duration)
            let (left, right) = try await (leftStats, rightStats)

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
                tempDir: tempDir
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

    return matches.sorted { lhs, rhs in
        let lhsTitled = !(lhs.title ?? "").isEmpty
        let rhsTitled = !(rhs.title ?? "").isEmpty
        if lhs.isOnScreen != rhs.isOnScreen { return lhs.isOnScreen && !rhs.isOnScreen }
        if lhsTitled != rhsTitled { return lhsTitled && !rhsTitled }
        if lhs.windowLayer != rhs.windowLayer { return lhs.windowLayer < rhs.windowLayer }
        let lhsArea = lhs.frame.width * lhs.frame.height
        let rhsArea = rhs.frame.width * rhs.frame.height
        return lhsArea > rhsArea
    }.first!
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

final class WindowRecorder: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let window: SCWindow
    private let displays: [SCDisplay]
    private let outputURL: URL
    private let fps: Int
    private let size: (width: Int, height: Int)
    private let sampleQueue = DispatchQueue(label: "spectra.composite.capture.sample")
    private let frameLock = NSLock()

    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var frameCount = 0
    private var sourceFrameCount = 0
    private var latestPixelBuffer: CVPixelBuffer?
    private var streamError: Error?

    init(window: SCWindow, displays: [SCDisplay], outputURL: URL, fps: Int) {
        self.window = window
        self.displays = displays
        self.outputURL = outputURL
        self.fps = fps
        self.size = outputSize(for: window, displays: displays)
    }

    @MainActor
    func record(duration: Double) async throws -> CaptureStats {
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
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)

        guard writer.startWriting() else {
            throw writer.error ?? CLIError(description: "AVAssetWriter failed to start")
        }
        writer.startSession(atSourceTime: .zero)

        try await start(stream)
        guard let firstFrame = await waitForFirstFrame(timeoutSeconds: 5) else {
            try await stop(stream)
            throw CLIError(description: "No frames captured for \(window.owningApplication?.applicationName ?? "unknown") window \(window.windowID)")
        }

        let targetFrames = max(1, Int((duration * Double(fps)).rounded()))
        let frameIntervalNanos = UInt64((1_000_000_000.0 / Double(fps)).rounded())
        let startedAt = DispatchTime.now().uptimeNanoseconds

        for frameIndex in 0..<targetFrames {
            let buffer = latestFrame() ?? firstFrame
            let presentationTime = CMTime(
                value: CMTimeValue(frameIndex) * ticksPerFrame,
                timescale: timeScale
            )
            try await appendFrame(buffer, at: presentationTime, timeoutNanos: frameIntervalNanos)

            let nextDeadline = startedAt + UInt64(frameIndex + 1) * frameIntervalNanos
            let now = DispatchTime.now().uptimeNanoseconds
            if nextDeadline > now {
                try await Task.sleep(nanoseconds: nextDeadline - now)
            }
        }

        try await stop(stream)

        sampleQueue.sync {}

        if let streamError {
            throw streamError
        }

        guard frameCount > 0 else {
            throw CLIError(description: "No frames captured for \(window.owningApplication?.applicationName ?? "unknown") window \(window.windowID)")
        }

        input.markAsFinished()
        await finish(writer)

        if writer.status != .completed {
            throw writer.error ?? CLIError(description: "AVAssetWriter failed for \(outputURL.path)")
        }

        return CaptureStats(
            path: outputURL.path,
            frames: frameCount,
            sourceFrames: sourceFrames(),
            width: size.width,
            height: size.height
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

    private func latestFrame() -> CVPixelBuffer? {
        frameLock.lock()
        let frame = latestPixelBuffer
        frameLock.unlock()
        return frame
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
func start(_ stream: SCStream) async throws {
    try await waitForStreamCallback(timeoutSeconds: 5, timeoutError: CLIError(description: "Timed out starting ScreenCaptureKit stream")) { done in
        stream.startCapture { error in
            done(error)
        }
    }
}

@MainActor
func stop(_ stream: SCStream) async throws {
    try await waitForStreamCallback(timeoutSeconds: 2, timeoutError: nil) { done in
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

func finish(_ writer: AVAssetWriter) async {
    await withCheckedContinuation { continuation in
        writer.finishWriting {
            continuation.resume()
        }
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
    tempDir: URL
) throws -> StitchResult {
    try? FileManager.default.removeItem(at: output)
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)

    let height = max(2, min(leftHeight, rightHeight) - (min(leftHeight, rightHeight) % 2))
    let hasDrawtext = ffmpegSupportsDrawtext()

    let filter: String
    var arguments = ["-y", "-i", left.path, "-i", right.path]

    if hasDrawtext {
        filter = "[0:v]fps=\(fps),scale=-2:\(height),setsar=1,drawtext=\(drawtext(label: leftLabel))[left];" +
            "[1:v]fps=\(fps),scale=-2:\(height),setsar=1,drawtext=\(drawtext(label: rightLabel))[right];" +
            "[left][right]hstack=inputs=2:shortest=1,fps=\(fps)[v]"
    } else {
        let leftLabelURL = tempDir.appendingPathComponent("left-label.png")
        let rightLabelURL = tempDir.appendingPathComponent("right-label.png")
        try writeLabelImage(leftLabel, to: leftLabelURL)
        try writeLabelImage(rightLabel, to: rightLabelURL)

        arguments += ["-i", leftLabelURL.path, "-i", rightLabelURL.path]
        filter = "[0:v]fps=\(fps),scale=-2:\(height),setsar=1[leftbase];" +
            "[1:v]fps=\(fps),scale=-2:\(height),setsar=1[rightbase];" +
            "[leftbase][2:v]overlay=16:16[left];" +
            "[rightbase][3:v]overlay=16:16[right];" +
            "[left][right]hstack=inputs=2:shortest=1,fps=\(fps)[v]"
    }

    arguments += [
        "-filter_complex", filter,
        "-map", "[v]",
        "-an",
        "-r", "\(fps)",
        "-vsync", "cfr",
        "-c:v", "libx264",
        "-b:v", "8M",
        "-pix_fmt", pixFmt,
        "-video_track_timescale", "\(max(600, fps * 1000))",
        "-movflags", "+faststart",
        output.path
    ]

    try runProcess("/usr/bin/env", ["ffmpeg"] + arguments)
    return StitchResult(filterComplex: filter, labelMode: hasDrawtext ? "drawtext" : "overlay-png")
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

func runProcess(_ executable: String, _ arguments: [String]) throws {
    let process = Process()
    let stderr = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = Pipe()
    process.standardError = stderr

    try process.run()
    process.waitUntilExit()

    if process.terminationStatus != 0 {
        let data = stderr.fileHandleForReading.readDataToEndOfFile()
        let message = String(data: data, encoding: .utf8) ?? "unknown error"
        throw CLIError(description: "Command failed: \(executable) \(arguments.joined(separator: " "))\n\(message)")
    }
}

func runProcessCapture(_ executable: String, _ arguments: [String]) throws -> String {
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
    process.waitUntilExit()

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

func validateVideo(_ url: URL, targetFps: Int) throws -> ValidationResult {
    let probe = try runProcessCapture("/usr/bin/env", [
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "frame=pts_time,best_effort_timestamp_time,pkt_pts_time,pkt_duration_time,duration_time:stream=duration,nb_frames:format=duration",
        "-of", "json",
        url.path
    ])

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
        ])
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
