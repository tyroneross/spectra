import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import CoreVideo
import CoreGraphics
import AppKit

struct SingleWindowRecordingError: Error, CustomStringConvertible {
    let description: String
}

struct SingleWindowRecordingStartResult: Encodable {
    let recordingId: String
    let path: String
    let startedAt: Int64
    let fps: Int
    let codec: String
    let bitrate: String
    let width: Int
    let height: Int
}

struct SingleWindowRecordingStopResult: Encodable {
    let recordingId: String
    let path: String
    let format: String
    let durationMs: Int
    let sizeBytes: Int64
    let codec: String
    let fps: Int
    let width: Int
    let height: Int
    let droppedFrames: Int
}

struct SingleWindowCaptureStats {
    let path: String
    let durationMs: Int
    let sizeBytes: Int64
    let frames: Int
    let sourceFrames: Int
    let width: Int
    let height: Int
    let status: String
}

struct SingleWindowReadyInfo {
    let width: Int
    let height: Int
}

@MainActor
final class SingleWindowRecordingStore {
    static let shared = SingleWindowRecordingStore()

    private var sessions: [String: SingleWindowRecordingSession] = [:]

    func start(params: [String: AnyCodableValue]) async throws -> SingleWindowRecordingStartResult {
        let recordingId = params["recordingId"]?.stringValue ?? "native-\(UUID().uuidString)"
        guard sessions[recordingId] == nil else {
            throw SingleWindowRecordingError(description: "Recording already exists: \(recordingId)")
        }
        let app = try requiredString(params, "app")
        let title = params["title"]?.stringValue
        let outPath = try requiredString(params, "outPath")
        let fps = max(1, params["fps"]?.intValue ?? 60)
        let codec = params["codec"]?.stringValue ?? "h264"
        let bitrate = params["bitrate"]?.stringValue ?? "8M"
        let maxDuration = max(0.5, params["maxDuration"]?.doubleValue ?? params["duration"]?.doubleValue ?? 300)
        let sessionId = params["sessionId"]?.stringValue

        let content = try await singleWindowShareableContent(timeoutSeconds: 15)
        let window = try selectSingleWindow(content.windows, app: app, title: title)
        let outputURL = URL(fileURLWithPath: outPath).standardizedFileURL
        try FileManager.default.createDirectory(
            at: outputURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let session = SingleWindowRecordingSession(
            recordingId: recordingId,
            sessionId: sessionId,
            window: window,
            displays: content.displays,
            outputURL: outputURL,
            fps: fps,
            codec: codec,
            bitrate: bitrate,
            maxDuration: maxDuration
        )
        sessions[recordingId] = session
        do {
            let ready = try await session.start()
            return SingleWindowRecordingStartResult(
                recordingId: recordingId,
                path: outputURL.path,
                startedAt: session.startedAtMillis,
                fps: fps,
                codec: codec,
                bitrate: bitrate,
                width: ready.width,
                height: ready.height
            )
        } catch {
            sessions.removeValue(forKey: recordingId)
            throw error
        }
    }

    func stop(params: [String: AnyCodableValue]) async throws -> SingleWindowRecordingStopResult {
        let recordingId = params["recordingId"]?.stringValue
        let sessionId = params["sessionId"]?.stringValue
        let session = try findSession(recordingId: recordingId, sessionId: sessionId)
        let stats = try await session.stop()
        sessions.removeValue(forKey: session.recordingId)
        return SingleWindowRecordingStopResult(
            recordingId: session.recordingId,
            path: stats.path,
            format: "mp4",
            durationMs: stats.durationMs,
            sizeBytes: stats.sizeBytes,
            codec: session.codec,
            fps: session.fps,
            width: stats.width,
            height: stats.height,
            droppedFrames: max(0, stats.frames - stats.sourceFrames)
        )
    }

    private func findSession(recordingId: String?, sessionId: String?) throws -> SingleWindowRecordingSession {
        if let recordingId {
            guard let session = sessions[recordingId] else {
                throw SingleWindowRecordingError(description: "No active recording: \(recordingId)")
            }
            return session
        }
        if let sessionId {
            let matches = sessions.values.filter { $0.sessionId == sessionId }
            guard let session = matches.first else {
                throw SingleWindowRecordingError(description: "No active recording for session: \(sessionId)")
            }
            guard matches.count == 1 else {
                throw SingleWindowRecordingError(description: "Multiple active recordings for session: \(sessionId)")
            }
            return session
        }
        guard sessions.count == 1, let session = sessions.values.first else {
            throw SingleWindowRecordingError(description: "Stop requires recordingId or sessionId")
        }
        return session
    }
}

@MainActor
final class SingleWindowRecordingSession {
    let recordingId: String
    let sessionId: String?
    let fps: Int
    let codec: String
    let bitrate: String
    let startedAtMillis: Int64

    private let recorder: SingleWindowRecorder
    private let stopControl = SingleWindowStopControl()
    private let ready = SingleWindowReadyState()
    private var task: Task<SingleWindowCaptureStats, Error>?
    private var stopped = false

    init(
        recordingId: String,
        sessionId: String?,
        window: SCWindow,
        displays: [SCDisplay],
        outputURL: URL,
        fps: Int,
        codec: String,
        bitrate: String,
        maxDuration: Double
    ) {
        self.recordingId = recordingId
        self.sessionId = sessionId
        self.fps = fps
        self.codec = codec
        self.bitrate = bitrate
        self.startedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        self.recorder = SingleWindowRecorder(
            window: window,
            displays: displays,
            outputURL: outputURL,
            fps: fps,
            codec: codec,
            bitrate: bitrate,
            maxDuration: maxDuration
        )
    }

    func start() async throws -> SingleWindowReadyInfo {
        let recorder = self.recorder
        let ready = self.ready
        let stopControl = self.stopControl
        task = Task { @MainActor in
            do {
                return try await recorder.record(stopControl: stopControl, ready: ready)
            } catch {
                ready.fail(error)
                throw error
            }
        }
        return try await ready.wait()
    }

    func stop() async throws -> SingleWindowCaptureStats {
        guard !stopped else {
            throw SingleWindowRecordingError(description: "Recording already stopped: \(recordingId)")
        }
        stopped = true
        stopControl.requestStop()
        guard let task else {
            throw SingleWindowRecordingError(description: "Recording never started: \(recordingId)")
        }
        return try await task.value
    }
}

final class SingleWindowStopControl: @unchecked Sendable {
    private let lock = NSLock()
    private var stopped = false

    func requestStop() {
        lock.lock()
        stopped = true
        lock.unlock()
    }

    var isStopped: Bool {
        lock.lock()
        let value = stopped
        lock.unlock()
        return value
    }
}

final class SingleWindowReadyState: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<SingleWindowReadyInfo, Error>?
    private var waiters: [CheckedContinuation<SingleWindowReadyInfo, Error>] = []

    func wait() async throws -> SingleWindowReadyInfo {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            if let result {
                lock.unlock()
                continuation.resume(with: result)
                return
            }
            waiters.append(continuation)
            lock.unlock()
        }
    }

    func succeed(_ info: SingleWindowReadyInfo) {
        resume(.success(info))
    }

    func fail(_ error: Error) {
        resume(.failure(error))
    }

    private func resume(_ result: Result<SingleWindowReadyInfo, Error>) {
        lock.lock()
        if self.result != nil {
            lock.unlock()
            return
        }
        self.result = result
        let pending = waiters
        waiters.removeAll()
        lock.unlock()
        for waiter in pending {
            waiter.resume(with: result)
        }
    }
}

final class SingleWindowHardStop: @unchecked Sendable {
    let limitSeconds: Double
    let startedAtNanos: UInt64

    private let lock = NSLock()
    private var timer: DispatchSourceTimer?
    private var fired = false

    init(maxDuration: Double, buffer: Double) {
        self.limitSeconds = max(0.1, maxDuration + buffer)
        self.startedAtNanos = DispatchTime.now().uptimeNanoseconds
    }

    var isFired: Bool {
        lock.lock()
        let deadline = startedAtNanos + UInt64((limitSeconds * 1_000_000_000.0).rounded())
        let value = fired || DispatchTime.now().uptimeNanoseconds >= deadline
        if value { fired = true }
        lock.unlock()
        return value
    }

    var remainingNanos: UInt64 {
        let deadline = startedAtNanos + UInt64((limitSeconds * 1_000_000_000.0).rounded())
        let now = DispatchTime.now().uptimeNanoseconds
        if now >= deadline { return 0 }
        return deadline - now
    }

    var remainingSeconds: Double {
        Double(remainingNanos) / 1_000_000_000.0
    }

    func start(_ onFire: @escaping @Sendable () -> Void) {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
        timer.schedule(deadline: .now() + limitSeconds)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.lock.lock()
            if self.fired {
                self.lock.unlock()
                return
            }
            self.fired = true
            self.lock.unlock()
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
}

final class SingleWindowRecorder: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let window: SCWindow
    private let displays: [SCDisplay]
    private let outputURL: URL
    private let fps: Int
    private let codec: String
    private let bitrate: String
    private let maxDuration: Double
    private let size: (width: Int, height: Int)
    private let sampleQueue = DispatchQueue(label: "spectra.single-window.capture.sample")
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

    init(
        window: SCWindow,
        displays: [SCDisplay],
        outputURL: URL,
        fps: Int,
        codec: String,
        bitrate: String,
        maxDuration: Double
    ) {
        self.window = window
        self.displays = displays
        self.outputURL = outputURL
        self.fps = fps
        self.codec = codec
        self.bitrate = bitrate
        self.maxDuration = maxDuration
        self.size = singleWindowOutputSize(for: window, displays: displays)
    }

    @MainActor
    func record(stopControl: SingleWindowStopControl, ready: SingleWindowReadyState) async throws -> SingleWindowCaptureStats {
        try? FileManager.default.removeItem(at: outputURL)

        let hardStop = SingleWindowHardStop(maxDuration: maxDuration, buffer: 5)
        hardStop.start { [weak self] in
            Task { @MainActor in
                self?.forceStop(reason: "hard_deadline")
            }
        }
        defer { hardStop.cancel() }

        let timeScale = CMTimeScale(max(600, fps * 1000))
        let ticksPerFrame = CMTimeValue(timeScale / CMTimeScale(fps))
        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        let videoCodec = singleWindowCodec(codec)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: videoCodec,
            AVVideoWidthKey: size.width,
            AVVideoHeightKey: size.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: singleWindowBitrateBits(bitrate, width: size.width, height: size.height, fps: fps),
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ])
        input.expectsMediaDataInRealTime = true
        input.mediaTimeScale = timeScale
        guard writer.canAdd(input) else {
            throw SingleWindowRecordingError(description: "AVAssetWriter cannot add video input for \(outputURL.path)")
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
        configuration.showsCursor = true
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

        let preStartSeed = await singleWindowSeedPixelBuffer(
            windowID: window.windowID,
            windowFrame: window.frame,
            displayScale: singleWindowDisplayScale(for: window, displays: displays),
            filter: filter,
            configuration: configuration,
            width: size.width,
            height: size.height,
            timeoutSeconds: min(5, max(0.1, hardStop.remainingSeconds))
        )

        guard writer.startWriting() else {
            throw writer.error ?? SingleWindowRecordingError(description: "AVAssetWriter failed to start")
        }
        writer.startSession(atSourceTime: .zero)

        try await singleWindowStart(stream, timeoutSeconds: min(5, max(0.1, hardStop.remainingSeconds)))
        if let preStartSeed {
            seedFrameIfEmpty(preStartSeed)
        }
        if latestFrame() == nil,
           let seed = await singleWindowSeedPixelBuffer(
                windowID: window.windowID,
                windowFrame: window.frame,
                displayScale: singleWindowDisplayScale(for: window, displays: displays),
                filter: filter,
                configuration: configuration,
                width: size.width,
                height: size.height,
                timeoutSeconds: min(5, max(0.1, hardStop.remainingSeconds))
           ) {
            seedFrameIfEmpty(seed)
        }

        var firstFrame = latestFrame()
        if firstFrame == nil {
            firstFrame = await waitForFirstFrame(timeoutSeconds: min(5, max(0.1, hardStop.remainingSeconds)))
        }
        guard let firstFrame else {
            try? await singleWindowStop(stream, timeoutSeconds: min(2, max(0.1, hardStop.remainingSeconds)))
            throw singleWindowNoFramesError(for: window)
        }

        ready.succeed(SingleWindowReadyInfo(width: size.width, height: size.height))

        let startedAt = DispatchTime.now().uptimeNanoseconds
        let maxFrames = max(1, Int((maxDuration * Double(fps)).rounded()))
        let frameIntervalNanos = UInt64((1_000_000_000.0 / Double(fps)).rounded())
        var frameIndex = 0
        var hitHardStop = false

        while frameIndex < maxFrames && !stopControl.isStopped {
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
            frameIndex += 1

            let nextDeadline = startedAt + UInt64(frameIndex) * frameIntervalNanos
            let now = DispatchTime.now().uptimeNanoseconds
            if nextDeadline > now {
                try await Task.sleep(nanoseconds: min(nextDeadline - now, hardStop.remainingNanos))
            }
        }

        try? await singleWindowStop(stream, timeoutSeconds: min(2, max(0.1, hardStop.remainingSeconds)))
        sampleQueue.sync {}

        if let streamError, frameCount == 0 {
            throw streamError
        }
        guard frameCount > 0 else {
            throw singleWindowNoFramesError(for: window)
        }

        input.markAsFinished()
        let didFinish = await singleWindowFinish(writer, timeoutSeconds: 10)
        guard didFinish else {
            writer.cancelWriting()
            throw SingleWindowRecordingError(description: "Timed out finalizing AVAssetWriter for \(outputURL.path)")
        }
        if writer.status != .completed {
            throw writer.error ?? SingleWindowRecordingError(description: "AVAssetWriter failed for \(outputURL.path)")
        }

        let attrs = try? FileManager.default.attributesOfItem(atPath: outputURL.path)
        let sizeBytes = attrs?[.size] as? Int64 ?? 0
        let durationMs = Int((Double(frameCount) / Double(fps) * 1000).rounded())
        let reason = forcedStop()
        let status = hitHardStop || reason == "hard_deadline"
            ? "hard_deadline"
            : frameIndex >= maxFrames ? "max_duration" : "stopped"
        return SingleWindowCaptureStats(
            path: outputURL.path,
            durationMs: durationMs,
            sizeBytes: sizeBytes,
            frames: frameCount,
            sourceFrames: sourceFrames(),
            width: size.width,
            height: size.height,
            status: status
        )
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              CMSampleBufferIsValid(sampleBuffer),
              let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer),
              singleWindowUsableFrame(sampleBuffer) else {
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

    @MainActor
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

    private func appendFrame(_ pixelBuffer: CVPixelBuffer, at presentationTime: CMTime, timeoutNanos: UInt64) async throws {
        guard let input, let adaptor else {
            throw SingleWindowRecordingError(description: "AVAssetWriter input not initialized")
        }
        let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanos
        while !input.isReadyForMoreMediaData && DispatchTime.now().uptimeNanoseconds < deadline {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        guard input.isReadyForMoreMediaData else {
            throw SingleWindowRecordingError(description: "AVAssetWriter input was not ready before the next CFR frame deadline")
        }
        if adaptor.append(pixelBuffer, withPresentationTime: presentationTime) {
            frameCount += 1
        } else {
            throw writer?.error ?? SingleWindowRecordingError(description: "Failed to append CFR frame")
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

func requiredString(_ params: [String: AnyCodableValue], _ key: String) throws -> String {
    guard let value = params[key]?.stringValue, !value.isEmpty else {
        throw SingleWindowRecordingError(description: "Missing \(key)")
    }
    return value
}

func singleWindowShareableContent(timeoutSeconds: Double) async throws -> SCShareableContent {
    try await withCheckedThrowingContinuation { continuation in
        let state = SingleWindowShareableContentState(continuation: continuation)
        Task {
            do {
                state.resume(.success(try await SCShareableContent.current))
            } catch {
                state.resume(.failure(error))
            }
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeoutSeconds) {
            state.resume(.failure(SingleWindowRecordingError(description: "Timed out reading ScreenCaptureKit shareable content")))
        }
    }
}

final class SingleWindowShareableContentState: @unchecked Sendable {
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
        continuation.resume(with: result)
    }
}

func selectSingleWindow(_ windows: [SCWindow], app: String, title: String?) throws -> SCWindow {
    let appNeedle = app.lowercased()
    let titleNeedle = title?.lowercased()
    let matches = windows.filter { window in
        let appName = window.owningApplication?.applicationName.lowercased() ?? ""
        let bundle = window.owningApplication?.bundleIdentifier.lowercased() ?? ""
        let windowTitle = (window.title ?? "").lowercased()
        let appMatches = appName.contains(appNeedle) || bundle.contains(appNeedle)
        let titleMatches = titleNeedle.map { windowTitle.contains($0) } ?? true
        return appMatches && titleMatches && singleWindowCaptureCandidate(window)
    }
    guard !matches.isEmpty else {
        let titlePart = title.map { " title containing '\($0)'" } ?? ""
        throw SingleWindowRecordingError(description: "No ScreenCaptureKit window found for app '\(app)'\(titlePart)")
    }
    let ordered = matches.sorted { lhs, rhs in
        let lhsTitled = !(lhs.title ?? "").isEmpty
        let rhsTitled = !(rhs.title ?? "").isEmpty
        if lhs.isOnScreen != rhs.isOnScreen { return lhs.isOnScreen && !rhs.isOnScreen }
        if lhsTitled != rhsTitled { return lhsTitled && !rhsTitled }
        if lhs.windowLayer != rhs.windowLayer { return lhs.windowLayer < rhs.windowLayer }
        return lhs.frame.width * lhs.frame.height > rhs.frame.width * rhs.frame.height
    }
    let selected = ordered.first!
    guard selected.isOnScreen else {
        throw SingleWindowRecordingError(description: "window \(selected.windowID) is off-screen/minimized; no frames")
    }
    return selected
}

func singleWindowCaptureCandidate(_ window: SCWindow) -> Bool {
    if window.windowLayer != 0 { return false }
    if window.frame.width < 100 || window.frame.height < 100 { return false }
    return true
}

func singleWindowOutputSize(for window: SCWindow, displays: [SCDisplay]) -> (width: Int, height: Int) {
    let scale = singleWindowDisplayScale(for: window, displays: displays)
    return (
        width: singleWindowEven(max(2, Int(ceil(window.frame.width * scale)))),
        height: singleWindowEven(max(2, Int(ceil(window.frame.height * scale))))
    )
}

func singleWindowDisplayScale(for window: SCWindow, displays: [SCDisplay]) -> Double {
    let center = CGPoint(x: window.frame.midX, y: window.frame.midY)
    let display = displays.first { $0.frame.contains(center) } ?? displays.first
    guard let display else { return 2.0 }
    let pixelWidth = CGDisplayPixelsWide(display.displayID)
    guard display.width > 0, pixelWidth > 0 else { return 2.0 }
    return Double(pixelWidth) / Double(display.width)
}

func singleWindowEven(_ value: Int) -> Int {
    value % 2 == 0 ? value : value + 1
}

func singleWindowCodec(_ value: String) -> AVVideoCodecType {
    value.lowercased() == "hevc" ? .hevc : .h264
}

func singleWindowBitrateBits(_ value: String, width: Int, height: Int, fps: Int) -> Int {
    let upper = value.uppercased()
    if upper.hasSuffix("M"), let n = Double(upper.dropLast()) {
        return Int(n * 1_000_000)
    }
    if let n = Int(value), n > 0 {
        return n
    }
    return max(8_000_000, width * height * fps / 8)
}

func singleWindowSeedPixelBuffer(
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
        if let seed = await singleWindowSCKSeedPixelBuffer(
            filter: filter,
            configuration: configuration,
            width: width,
            height: height,
            timeoutSeconds: timeoutSeconds
        ) {
            return seed
        }
    }
    return singleWindowScreencaptureSeedPixelBuffer(
        windowID: windowID,
        windowFrame: windowFrame,
        displayScale: displayScale,
        width: width,
        height: height
    )
}

@available(macOS 14.0, *)
func singleWindowSCKSeedPixelBuffer(
    filter: SCContentFilter,
    configuration: SCStreamConfiguration,
    width: Int,
    height: Int,
    timeoutSeconds: Double
) async -> CVPixelBuffer? {
    await withCheckedContinuation { continuation in
        let state = SingleWindowSeedCaptureState(continuation: continuation)
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, _ in
            guard let image else {
                state.resume(nil)
                return
            }
            state.resume(singleWindowPixelBuffer(from: image, width: width, height: height))
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeoutSeconds) {
            state.resume(nil)
        }
    }
}

final class SingleWindowSeedCaptureState: @unchecked Sendable {
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

func singleWindowPixelBuffer(from cgImage: CGImage, width: Int, height: Int) -> CVPixelBuffer? {
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

func singleWindowScreencaptureSeedPixelBuffer(
    windowID: UInt32,
    windowFrame: CGRect,
    displayScale: Double,
    width: Int,
    height: Int
) -> CVPixelBuffer? {
    let tempDir = FileManager.default.temporaryDirectory
        .appendingPathComponent("spectra-single-seed-\(UUID().uuidString)", isDirectory: true)
    let pngURL = tempDir.appendingPathComponent("seed.png")
    do {
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }
        try singleWindowRunProcess("/usr/sbin/screencapture", ["-x", pngURL.path], timeoutSeconds: 5)
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
        guard !cropRect.isNull, let cropped = cgImage.cropping(to: cropRect) else {
            return nil
        }
        return singleWindowPixelBuffer(from: cropped, width: width, height: height)
    } catch {
        return nil
    }
}

func singleWindowNoFramesError(for window: SCWindow) -> SingleWindowRecordingError {
    if !window.isOnScreen {
        return SingleWindowRecordingError(description: "window \(window.windowID) is off-screen/minimized; no frames")
    }
    let app = window.owningApplication?.applicationName ?? "unknown"
    return SingleWindowRecordingError(description: "No frames captured for \(app) window \(window.windowID); verify the window is visible and Screen Recording permission is granted")
}

func singleWindowUsableFrame(_ sampleBuffer: CMSampleBuffer) -> Bool {
    guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
          let statusRaw = attachments.first?[SCStreamFrameInfo.status] as? Int,
          let status = SCFrameStatus(rawValue: statusRaw) else {
        return true
    }
    return status == .complete || status == .idle || status == .started
}

@MainActor
func singleWindowStart(_ stream: SCStream, timeoutSeconds: Double = 5) async throws {
    try await singleWindowWaitForStreamCallback(
        timeoutSeconds: timeoutSeconds,
        timeoutError: SingleWindowRecordingError(description: "Timed out starting ScreenCaptureKit stream")
    ) { done in
        stream.startCapture { error in
            done(error)
        }
    }
}

@MainActor
func singleWindowStop(_ stream: SCStream, timeoutSeconds: Double = 2) async throws {
    try await singleWindowWaitForStreamCallback(timeoutSeconds: timeoutSeconds, timeoutError: nil) { done in
        stream.stopCapture { error in
            done(error)
        }
    }
}

@MainActor
func singleWindowWaitForStreamCallback(
    timeoutSeconds: Double,
    timeoutError: Error?,
    _ operation: (@escaping (Error?) -> Void) -> Void
) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        let state = SingleWindowStreamCallbackState(continuation: continuation)
        operation { error in
            state.resume(error)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds) {
            state.resume(timeoutError)
        }
    }
}

final class SingleWindowStreamCallbackState: @unchecked Sendable {
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

func singleWindowFinish(_ writer: AVAssetWriter, timeoutSeconds: Double) async -> Bool {
    await withCheckedContinuation { continuation in
        let state = SingleWindowFinishWriterState(continuation: continuation)
        writer.finishWriting {
            state.resume(true)
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeoutSeconds) {
            state.resume(false)
        }
    }
}

final class SingleWindowFinishWriterState: @unchecked Sendable {
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

func singleWindowRunProcess(_ executable: String, _ arguments: [String], timeoutSeconds: Double) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while process.isRunning && Date() < deadline {
        Thread.sleep(forTimeInterval: 0.02)
    }
    if process.isRunning {
        process.terminate()
        throw SingleWindowRecordingError(description: "\(executable) timed out")
    }
    guard process.terminationStatus == 0 else {
        throw SingleWindowRecordingError(description: "\(executable) exited with \(process.terminationStatus)")
    }
}
