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
    sendError(id: req.id, code: -1, message: "Not implemented: screenshot")
}

func handleSimDevices(_ req: Request) {
    sendError(id: req.id, code: -1, message: "Not implemented: simDevices")
}

func handleSimScreenshot(_ req: Request) {
    sendError(id: req.id, code: -1, message: "Not implemented: simScreenshot")
}

func handleSimRecord(_ req: Request) {
    sendError(id: req.id, code: -1, message: "Not implemented: simRecord")
}

func handleSimTap(_ req: Request) {
    sendError(id: req.id, code: -1, message: "Not implemented: simTap")
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
