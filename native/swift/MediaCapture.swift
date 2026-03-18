// native/swift/MediaCapture.swift
import Foundation

// ─── Error Type ───────────────────────────────────────────

struct MediaCaptureError: Error {
    let message: String
}

// ─── Window Screenshot (screencapture) ────────────────────

func captureWindowScreenshot(windowId: Int) -> Result<String, MediaCaptureError> {
    let tmpPath = NSTemporaryDirectory() + "spectra-ss-\(UUID().uuidString).png"

    // Try window-specific capture first
    let windowProcess = Process()
    windowProcess.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    windowProcess.arguments = ["-l", String(windowId), "-x", tmpPath]
    windowProcess.standardOutput = FileHandle.nullDevice
    windowProcess.standardError = FileHandle.nullDevice

    do {
        try windowProcess.run()
        windowProcess.waitUntilExit()
    } catch {
        return .failure(MediaCaptureError(message: "screencapture failed: \(error)"))
    }

    // If window-specific failed, fall back to full-screen capture
    // (Screen Recording permission may not be granted)
    if windowProcess.terminationStatus != 0 {
        let fullProcess = Process()
        fullProcess.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        fullProcess.arguments = ["-x", tmpPath]
        fullProcess.standardOutput = FileHandle.nullDevice
        fullProcess.standardError = FileHandle.nullDevice

        do {
            try fullProcess.run()
            fullProcess.waitUntilExit()
        } catch {
            return .failure(MediaCaptureError(message: "screencapture failed: \(error)"))
        }

        if fullProcess.terminationStatus != 0 {
            return .failure(MediaCaptureError(message: "screencapture failed (window-specific and full-screen both failed)"))
        }
    }

    return .success(tmpPath)
}
