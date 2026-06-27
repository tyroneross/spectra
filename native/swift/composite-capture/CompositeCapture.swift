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
    let width: Int
    let height: Int
}

struct CompositeResult: Encodable {
    let output: String
    let left: CaptureStats
    let right: CaptureStats
    let leftWindow: WindowRecord
    let rightWindow: WindowRecord
    let filterComplex: String
    let labelMode: String
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
    var duration: Double = 5
    var fps: Int = 30
    var keepParts = false
}

@main
struct SpectraCompositeCapture {
    static func main() async {
        do {
            let options = try parseOptions(CommandLine.arguments)

            if CommandLine.arguments.contains("--help") || CommandLine.arguments.contains("-h") {
                printUsage()
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
                tempDir: tempDir
            )

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
                labelMode: stitch.labelMode
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
  --fps <frames>              Capture FPS. Default: 30.
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

    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var frameCount = 0
    private var streamError: Error?

    init(window: SCWindow, displays: [SCDisplay], outputURL: URL, fps: Int) {
        self.window = window
        self.displays = displays
        self.outputURL = outputURL
        self.fps = fps
        self.size = outputSize(for: window, displays: displays)
    }

    func record(duration: Double) async throws -> CaptureStats {
        try? FileManager.default.removeItem(at: outputURL)

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: size.width,
            AVVideoHeightKey: size.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: max(2_000_000, size.width * size.height * 4),
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ])
        input.expectsMediaDataInRealTime = true

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
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
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
        try await start(stream)
        try await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
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

        return CaptureStats(path: outputURL.path, frames: frameCount, width: size.width, height: size.height)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              CMSampleBufferIsValid(sampleBuffer),
              let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer),
              let writer,
              let input,
              let adaptor else {
            return
        }

        if !isUsableFrame(sampleBuffer) {
            return
        }

        if frameCount == 0 {
            guard writer.startWriting() else {
                streamError = writer.error ?? CLIError(description: "AVAssetWriter failed to start")
                return
            }
            writer.startSession(atSourceTime: .zero)
        }

        guard input.isReadyForMoreMediaData else { return }

        let presentationTime = CMTime(value: CMTimeValue(frameCount), timescale: CMTimeScale(fps))
        if adaptor.append(imageBuffer, withPresentationTime: presentationTime) {
            frameCount += 1
        } else if streamError == nil {
            streamError = writer.error ?? CLIError(description: "Failed to append frame")
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        streamError = error
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

func start(_ stream: SCStream) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        stream.startCapture { error in
            if let error {
                continuation.resume(throwing: error)
            } else {
                continuation.resume()
            }
        }
    }
}

func stop(_ stream: SCStream) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        stream.stopCapture { error in
            if let error {
                continuation.resume(throwing: error)
            } else {
                continuation.resume()
            }
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
    tempDir: URL
) throws -> StitchResult {
    try? FileManager.default.removeItem(at: output)
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)

    let height = max(2, min(leftHeight, rightHeight) - (min(leftHeight, rightHeight) % 2))
    let hasDrawtext = ffmpegSupportsDrawtext()

    let filter: String
    var arguments = ["-y", "-i", left.path, "-i", right.path]

    if hasDrawtext {
        filter = "[0:v]scale=-2:\(height),setsar=1,drawtext=\(drawtext(label: leftLabel))[left];" +
            "[1:v]scale=-2:\(height),setsar=1,drawtext=\(drawtext(label: rightLabel))[right];" +
            "[left][right]hstack=inputs=2:shortest=1[v]"
    } else {
        let leftLabelURL = tempDir.appendingPathComponent("left-label.png")
        let rightLabelURL = tempDir.appendingPathComponent("right-label.png")
        try writeLabelImage(leftLabel, to: leftLabelURL)
        try writeLabelImage(rightLabel, to: rightLabelURL)

        arguments += ["-i", leftLabelURL.path, "-i", rightLabelURL.path]
        filter = "[0:v]scale=-2:\(height),setsar=1[leftbase];" +
            "[1:v]scale=-2:\(height),setsar=1[rightbase];" +
            "[leftbase][2:v]overlay=16:16[left];" +
            "[rightbase][3:v]overlay=16:16[right];" +
            "[left][right]hstack=inputs=2:shortest=1[v]"
    }

    arguments += [
        "-filter_complex", filter,
        "-map", "[v]",
        "-an",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
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
