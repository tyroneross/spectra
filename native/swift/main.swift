// native/swift/main.swift
import Foundation
import ApplicationServices

// ─── Response Helpers ─────────────────────────────────────

let encoder: JSONEncoder = {
    let e = JSONEncoder()
    e.outputFormatting = [] // compact JSON, no pretty print
    return e
}()

let decoder = JSONDecoder()
let responseLock = NSLock()

func sendResponse(_ response: Response) {
    guard let data = try? encoder.encode(response) else {
        fputs("ERROR: Failed to encode response\n", stderr)
        return
    }
    guard let json = String(data: data, encoding: .utf8) else { return }
    responseLock.lock()
    print(json) // stdout — newline-delimited JSON
    fflush(stdout)
    responseLock.unlock()
}

func sendResult(id: Int, _ value: AnyCodableValue) {
    sendResponse(Response(id: id, result: value, error: nil))
}

func sendError(id: Int, code: Int, message: String) {
    sendResponse(Response(id: id, result: nil, error: ResponseError(code: code, message: message)))
}

// ─── Permission Check ─────────────────────────────────────

func checkAccessibilityPermission() -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): false] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

// ─── Method Dispatch ──────────────────────────────────────

func handleRequest(_ request: Request) {
    switch request.method {
    case "ping":
        sendResult(id: request.id, .dictionary(["pong": .bool(true)]))

    case "quit":
        sendResult(id: request.id, .dictionary(["bye": .bool(true)]))
        exit(0)

    case "snapshot":
        handleSnapshot(request)

    case "act":
        handleAct(request)

    case "find":
        handleFind(request)

    case "screenshot":
        handleScreenshot(request)

    case "simDevices":
        handleSimDevices(request)

    case "simScreenshot":
        handleSimScreenshot(request)

    case "simRecord":
        handleSimRecord(request)

    case "simTap":
        handleSimTap(request)

    case "startRecording":
        handleStartRecording(request)

    case "stopRecording":
        handleStopRecording(request)

    default:
        sendError(id: request.id, code: -32601, message: "Unknown method: \(request.method)")
    }
}

// ─── Stubs (implemented in other files) ───────────────────

func handleSnapshot(_ req: Request) {
    switch getAppPid(from: req.params) {
    case .success(let pid):
        switch snapshotApp(pid: pid) {
        case .success(let result):
            sendResult(id: req.id, AnyCodableValue.from(result))
        case .failure(let err):
            sendError(id: req.id, code: -1, message: err.message)
        }
    case .failure(let err):
        sendError(id: req.id, code: -1, message: err.message)
    }
}

func handleAct(_ req: Request) {
    guard let params = req.params else {
        sendError(id: req.id, code: -1, message: "Missing params")
        return
    }

    switch getAppPid(from: params) {
    case .success(let pid):
        // Parse element path from params
        guard let pathValue = params["elementPath"],
              case .array(let pathArray) = pathValue else {
            sendError(id: req.id, code: -1, message: "Missing elementPath")
            return
        }
        let path = pathArray.compactMap { $0.intValue }

        guard let action = params["action"]?.stringValue else {
            sendError(id: req.id, code: -1, message: "Missing action")
            return
        }

        let value = params["value"]?.stringValue

        switch performAction(pid: pid, elementPath: path, action: action, value: value) {
        case .success(_):
            sendResult(id: req.id, .dictionary(["success": .bool(true)]))
        case .failure(let err):
            sendResult(id: req.id, .dictionary(["success": .bool(false), "error": .string(err.message)]))
        }
    case .failure(let err):
        sendError(id: req.id, code: -1, message: err.message)
    }
}

func handleFind(_ req: Request) {
    switch getAppPid(from: req.params) {
    case .success(let pid):
        let role = req.params?["role"]?.stringValue
        let label = req.params?["label"]?.stringValue
        let elements = findElements(pid: pid, role: role, label: label)
        sendResult(id: req.id, AnyCodableValue.from(elements))
    case .failure(let err):
        sendError(id: req.id, code: -1, message: err.message)
    }
}

func handleScreenshot(_ req: Request) {
    switch getAppPid(from: req.params) {
    case .success(_):
        // For now, capture the entire screen since we need CGWindowID to capture a specific window
        // which requires additional window enumeration work
        let tmpPath = NSTemporaryDirectory() + "spectra-screenshot-\(UUID().uuidString).png"

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-x", tmpPath]  // -x = no sound

        do {
            try process.run()
            process.waitUntilExit()

            if process.terminationStatus == 0 {
                sendResult(id: req.id, .dictionary(["path": .string(tmpPath)]))
            } else {
                sendError(id: req.id, code: -1, message: "screencapture failed with status \(process.terminationStatus)")
            }
        } catch {
            sendError(id: req.id, code: -1, message: "Failed to run screencapture: \(error)")
        }
    case .failure(let err):
        sendError(id: req.id, code: -1, message: err.message)
    }
}

func handleSimDevices(_ req: Request) {
    let devices = listSimDevices()
    sendResult(id: req.id, AnyCodableValue.from(["devices": devices]))
}

func handleSimScreenshot(_ req: Request) {
    guard let udid = req.params?["deviceId"]?.stringValue else {
        sendError(id: req.id, code: -1, message: "Missing deviceId")
        return
    }
    let mask = req.params?["mask"]?.stringValue
    switch simScreenshot(udid: udid, mask: mask) {
    case .success(let path):
        sendResult(id: req.id, .dictionary(["path": .string(path)]))
    case .failure(let err):
        sendError(id: req.id, code: -1, message: err.message)
    }
}

func handleSimRecord(_ req: Request) {
    guard let params = req.params,
          let deviceId = params["deviceId"]?.stringValue,
          let action = params["action"]?.stringValue else {
        sendError(id: req.id, code: -1, message: "Missing deviceId or action")
        return
    }

    if action == "start" {
        switch simStartRecording(udid: deviceId) {
        case .success(let recordingId):
            sendResult(id: req.id, .dictionary(["recordingId": .string(recordingId)]))
        case .failure(let err):
            sendError(id: req.id, code: -1, message: err.message)
        }
    } else if action == "stop" {
        guard let recordingId = params["recordingId"]?.stringValue else {
            sendError(id: req.id, code: -1, message: "Missing recordingId for stop")
            return
        }
        switch simStopRecording(recordingId: recordingId) {
        case .success(let path):
            sendResult(id: req.id, .dictionary(["path": .string(path)]))
        case .failure(let err):
            sendError(id: req.id, code: -1, message: err.message)
        }
    } else {
        sendError(id: req.id, code: -1, message: "Unknown action: \(action). Use 'start' or 'stop'.")
    }
}

func handleSimTap(_ req: Request) {
    guard let params = req.params,
          let deviceId = params["deviceId"]?.stringValue,
          let x = params["x"]?.intValue,
          let y = params["y"]?.intValue else {
        sendError(id: req.id, code: -1, message: "Missing deviceId, x, or y")
        return
    }
    switch simTap(udid: deviceId, x: x, y: y) {
    case .success(_):
        sendResult(id: req.id, .dictionary(["success": .bool(true)]))
    case .failure(let err):
        sendResult(id: req.id, .dictionary(["success": .bool(false), "error": .string(err.message)]))
    }
}

func handleStartRecording(_ req: Request) {
    sendError(id: req.id, code: -1, message: "Not implemented: startRecording")
}

func handleStopRecording(_ req: Request) {
    sendError(id: req.id, code: -1, message: "Not implemented: stopRecording")
}

// ─── Main Loop ────────────────────────────────────────────

let requestQueue = DispatchQueue(label: "spectra.native.requests", attributes: .concurrent)

// Read stdin on a background thread to keep main thread free for NSWorkspace calls
DispatchQueue.global(qos: .userInitiated).async {
    fputs("spectra-native started\n", stderr)

    // Check accessibility on startup (non-blocking)
    if !checkAccessibilityPermission() {
        fputs("WARNING: Accessibility permission not granted. Open System Settings → Privacy & Security → Accessibility and add Terminal (or your IDE).\n", stderr)
    }

    while let line = readLine() {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { continue }

        guard let data = trimmed.data(using: .utf8) else {
            fputs("ERROR: Invalid UTF-8 input\n", stderr)
            continue
        }

        do {
            let request = try decoder.decode(Request.self, from: data)
            requestQueue.async {
                handleRequest(request)
            }
        } catch {
            fputs("ERROR: Failed to parse request: \(error)\n", stderr)
        }
    }
    // stdin closed - continue running to allow async tasks to complete
}

RunLoop.main.run() // Keep main thread run loop alive for NSWorkspace and async work
