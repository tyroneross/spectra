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
    sendError(id: req.id, code: -1, message: "Not implemented: snapshot")
}

func handleAct(_ req: Request) {
    sendError(id: req.id, code: -1, message: "Not implemented: act")
}

func handleFind(_ req: Request) {
    sendError(id: req.id, code: -1, message: "Not implemented: find")
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

fputs("spectra-native started\n", stderr)

// Check accessibility on startup (non-blocking)
if !checkAccessibilityPermission() {
    fputs("WARNING: Accessibility permission not granted. Open System Settings → Privacy & Security → Accessibility and add Terminal (or your IDE).\n", stderr)
}

let requestQueue = DispatchQueue(label: "spectra.native.requests", attributes: .concurrent)

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

dispatchMain() // Keep run loop alive for async work
