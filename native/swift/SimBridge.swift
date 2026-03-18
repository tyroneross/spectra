// native/swift/SimBridge.swift
import Foundation

// ─── Error Types ──────────────────────────────────────────

struct SimBridgeError: Error {
    let message: String
}

// ─── simctl Device Listing ────────────────────────────────

struct SimctlOutput: Decodable {
    let devices: [String: [SimctlDevice]]
}

struct SimctlDevice: Decodable {
    let udid: String
    let name: String
    let state: String
}

func listSimDevices() -> [SimDevice] {
    let pipe = Pipe()
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["simctl", "list", "devices", "--json"]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice

    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        return []
    }

    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    guard let output = try? JSONDecoder().decode(SimctlOutput.self, from: data) else {
        return []
    }

    var result: [SimDevice] = []
    for (runtime, devices) in output.devices {
        for device in devices {
            result.append(SimDevice(
                udid: device.udid,
                name: device.name,
                state: device.state,
                runtime: runtime
            ))
        }
    }
    return result
}

// ─── simctl Screenshot ────────────────────────────────────

func simScreenshot(udid: String, mask: String? = nil) -> Result<String, SimBridgeError> {
    let tmpPath = NSTemporaryDirectory() + "spectra-sim-\(UUID().uuidString).png"

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    var args = ["simctl", "io", udid, "screenshot", tmpPath]
    if let mask = mask {
        args.insert("--mask=\(mask)", at: 4)
    }
    process.arguments = args
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice

    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        return .failure(SimBridgeError(message: "simctl screenshot failed: \(error)"))
    }

    if process.terminationStatus != 0 {
        return .failure(SimBridgeError(message: "simctl screenshot exited with code \(process.terminationStatus)"))
    }

    return .success(tmpPath)
}

// ─── simctl Video Recording ───────────────────────────────

private let recordingsLock = NSLock()
private var activeRecordings: [String: Process] = [:]

func simStartRecording(udid: String) -> Result<String, SimBridgeError> {
    let tmpPath = NSTemporaryDirectory() + "spectra-sim-\(UUID().uuidString).mp4"

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["simctl", "io", udid, "recordVideo", tmpPath]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice

    do {
        try process.run()
    } catch {
        return .failure(SimBridgeError(message: "simctl recordVideo failed: \(error)"))
    }

    let recordingId = UUID().uuidString
    recordingsLock.lock()
    activeRecordings[recordingId] = process
    recordingsLock.unlock()
    return .success(recordingId)
}

func simStopRecording(recordingId: String) -> Result<String, SimBridgeError> {
    recordingsLock.lock()
    let process = activeRecordings[recordingId]
    recordingsLock.unlock()

    guard let process = process else {
        return .failure(SimBridgeError(message: "Recording not found: \(recordingId)"))
    }

    process.interrupt() // SIGINT — simctl stops recording gracefully
    process.waitUntilExit()
    recordingsLock.lock()
    activeRecordings.removeValue(forKey: recordingId)
    recordingsLock.unlock()

    guard let args = process.arguments, let path = args.last else {
        return .failure(SimBridgeError(message: "Could not determine recording output path"))
    }

    return .success(path)
}

// ─── simctl Tap ───────────────────────────────────────────

func simTap(udid: String, x: Int, y: Int) -> Result<Bool, SimBridgeError> {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["simctl", "io", udid, "tap", String(x), String(y)]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice

    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        return .failure(SimBridgeError(message: "simctl tap failed: \(error)"))
    }

    return .success(process.terminationStatus == 0)
}
