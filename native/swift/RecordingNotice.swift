import AppKit
import AVFoundation
import CoreMedia

/// Configures an MP4 writer so completed fragments remain playable if the
/// recorder is terminated before `finishWriting()` can write a final index.
func configureCrashSafeMovieWriter(_ writer: AVAssetWriter) {
    let interval = CMTime(seconds: 1, preferredTimescale: 600)
    writer.movieFragmentInterval = interval
    writer.initialMovieFragmentInterval = interval
}

/// H.264 compression properties shared by ScreenCaptureKit recording paths. A
/// one-second fragment is only a one-second recovery boundary when the encoder
/// also produces a keyframe at least once per second.
func crashSafeVideoCompressionProperties(
    framesPerSecond fps: Int,
    averageBitRate: Int
) -> [String: Any] {
    [
        AVVideoAverageBitRateKey: averageBitRate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalKey: max(1, fps),
        AVVideoMaxKeyFrameIntervalDurationKey: 1.0,
        AVVideoAllowFrameReorderingKey: false,
    ]
}

/// One non-activating disclosure HUD per helper process. Callers hold a token
/// for the lifetime of each active capture; the window disappears when the
/// final token ends, and macOS removes it automatically if the helper dies.
@MainActor
final class RecordingNotice: NSObject {
    static let shared = RecordingNotice()

    private var activeTokens = Set<String>()
    private var panel: NSPanel?
    private var label: NSTextField?
    private var blinkTimer: Timer?
    private var dotVisible = true

    func recordingStarted(_ token: String) {
        activeTokens.insert(token)
        guard panel == nil else { return }
        showPanel()
    }

    func recordingStopped(_ token: String) {
        activeTokens.remove(token)
        guard activeTokens.isEmpty else { return }
        hidePanel()
    }

    private func showPanel() {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }

        _ = NSApplication.shared.setActivationPolicy(.accessory)

        let width: CGFloat = 310
        let height: CGFloat = 36
        let visibleFrame = screen.visibleFrame
        let frame = NSRect(
            x: visibleFrame.midX - width / 2,
            y: visibleFrame.maxY - height - 10,
            width: width,
            height: height
        )
        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .statusBar
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.setAccessibilityLabel("Spectra recording in progress")

        let material = NSVisualEffectView(frame: NSRect(origin: .zero, size: frame.size))
        material.material = .hudWindow
        material.blendingMode = .behindWindow
        material.state = .active
        material.wantsLayer = true
        material.layer?.cornerRadius = 9
        material.layer?.masksToBounds = true

        let label = NSTextField(labelWithString: "●  REC  Spectra capture in progress")
        label.frame = NSRect(x: 14, y: 8, width: width - 28, height: 20)
        label.font = .systemFont(ofSize: 13, weight: .semibold)
        label.textColor = .labelColor
        label.alignment = .center
        label.setAccessibilityLabel("Recording. Spectra capture in progress.")
        updateLabel(label, dotAlpha: 1)
        material.addSubview(label)

        panel.contentView = material
        panel.orderFrontRegardless()

        self.panel = panel
        self.label = label
        dotVisible = true

        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        let timer = Timer(timeInterval: 0.7, target: self, selector: #selector(toggleDot), userInfo: nil, repeats: true)
        RunLoop.main.add(timer, forMode: .common)
        blinkTimer = timer
    }

    private func hidePanel() {
        blinkTimer?.invalidate()
        blinkTimer = nil
        panel?.orderOut(nil)
        panel?.close()
        panel = nil
        label = nil
        dotVisible = true
    }

    @objc private func toggleDot() {
        guard let label else { return }
        dotVisible.toggle()
        updateLabel(label, dotAlpha: dotVisible ? 1 : 0.28)
    }

    private func updateLabel(_ label: NSTextField, dotAlpha: CGFloat) {
        let text = "●  REC  Spectra capture in progress"
        let attributed = NSMutableAttributedString(
            string: text,
            attributes: [
                .font: NSFont.systemFont(ofSize: 13, weight: .semibold),
                .foregroundColor: NSColor.labelColor,
            ]
        )
        attributed.addAttribute(
            .foregroundColor,
            value: NSColor.systemRed.withAlphaComponent(dotAlpha),
            range: NSRange(location: 0, length: 1)
        )
        label.attributedStringValue = attributed
    }
}
