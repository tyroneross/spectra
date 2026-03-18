# Spectra Phase 2 — Native Platforms Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add macOS, iOS simulator, and watchOS simulator automation via a persistent Swift binary communicating with TypeScript over JSON-RPC stdin/stdout, plus unified media capture.

**Architecture:** A compiled Swift binary (`spectra-native`) runs as a subprocess. TypeScript `NativeBridge` manages its lifecycle and translates JSON-RPC. `NativeDriver` and `SimDriver` implement the existing `Driver` interface. A `MediaCapture` module unifies screenshots and video across all platforms.

**Tech Stack:** Swift 5.9+ (AXUIElement, ScreenCaptureKit, xcrun simctl), TypeScript (Node.js 22+), Vitest (integration tests against real apps/simulators)

**Spec:** `docs/superpowers/specs/2026-03-18-spectra-phase2-design.md`

**Important:** All tests in Phase 2 are **integration tests** — they run against the real Swift binary and real macOS apps/simulators. The Swift binary and test app must be built before tests can run. Use `npm run build:native && npm run build:test-app` before running any Phase 2 tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `native/swift/Types.swift` | Create | Codable JSON-RPC structs (Request, Response, NativeElement, WindowInfo, SimDevice) |
| `native/swift/main.swift` | Create | stdin read loop, method dispatch, stdout response writing |
| `native/swift/AppTarget.swift` | Create | NSRunningApplication lookup by name → PID |
| `native/swift/AXBridge.swift` | Create | AXUIElement tree walk, action execution, role→action mapping |
| `native/swift/SimBridge.swift` | Create | xcrun simctl wrappers (devices, screenshot, record, tap) |
| `native/swift/MediaCapture.swift` | Create | screencapture + ScreenCaptureKit for macOS media |
| `native/swift/TestApp/TestApp.swift` | Create | Minimal SwiftUI test fixture with known elements |
| `src/native/compiler.ts` | Create | Swift binary compilation + source hash caching |
| `src/native/bridge.ts` | Create | NativeBridge — subprocess spawn, JSON-RPC, health monitoring |
| `src/native/driver.ts` | Create | NativeDriver — implements Driver via bridge |
| `src/native/sim.ts` | Create | SimDriver + simulator device management |
| `src/media/ffmpeg.ts` | Create | ffmpeg detection + transcode |
| `src/media/capture.ts` | Create | Unified screenshot/video API across platforms |
| `src/media/recorder.ts` | Create | RecordHandle implementations per platform |
| `src/mcp/context.ts` | Modify | Add Driver (not just CdpDriver), sim: detection with simctl |
| `src/mcp/tools/connect.ts` | Modify | Driver routing: CdpDriver / NativeDriver / SimDriver |
| `src/mcp/tools/capture.ts` | Modify | Route to MediaCapture instead of CDP-only |
| `package.json` | Modify | Add build:native, build:test-app scripts |
| `tests/native/compiler.test.ts` | Create | Compilation, hash check, staleness detection |
| `tests/native/bridge.test.ts` | Create | Binary spawn, JSON-RPC, ping, timeout, crash recovery |
| `tests/native/driver.test.ts` | Create | NativeDriver against test app (snapshot, act, screenshot) |
| `tests/native/sim.test.ts` | Create | SimDriver against booted simulator |
| `tests/media/capture.test.ts` | Create | Screenshots across platforms |
| `tests/media/recorder.test.ts` | Create | Video recording + transcode |

---

## Chunk 1: Swift Foundation

### Task 1: Swift Types and JSON-RPC Protocol

**Files:**
- Create: `native/swift/Types.swift`

All Codable structs for the JSON-RPC protocol between TypeScript and Swift.

- [ ] **Step 1: Create Types.swift with all protocol structs**

```swift
// native/swift/Types.swift
import Foundation

// ─── JSON-RPC Protocol ────────────────────────────────────

struct Request: Decodable {
    let id: Int
    let method: String
    let params: [String: AnyCodableValue]?
}

struct Response: Encodable {
    let id: Int
    let result: AnyCodableValue?
    let error: ResponseError?
}

struct ResponseError: Codable {
    let code: Int
    let message: String
}

// ─── Native Elements ──────────────────────────────────────

struct NativeElement: Codable {
    let role: String
    let label: String
    let value: String?
    let enabled: Bool
    let focused: Bool
    let actions: [String]
    let bounds: [Double]  // [x, y, width, height]
    let path: [Int]       // index path from root for act() targeting
}

struct WindowInfo: Codable {
    let id: Int
    let title: String
    let bounds: [Double]  // [x, y, width, height]
}

struct SnapshotResult: Codable {
    let elements: [NativeElement]
    let window: WindowInfo
}

// ─── Simulator Types ──────────────────────────────────────

struct SimDevice: Codable {
    let udid: String
    let name: String
    let state: String
    let runtime: String
}

// ─── AnyCodableValue ──────────────────────────────────────
// Flexible JSON value type for params and results

enum AnyCodableValue: Codable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([AnyCodableValue])
    case dictionary([String: AnyCodableValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Bool.self) { self = .bool(v) }
        else if let v = try? container.decode(Int.self) { self = .int(v) }
        else if let v = try? container.decode(Double.self) { self = .double(v) }
        else if let v = try? container.decode(String.self) { self = .string(v) }
        else if let v = try? container.decode([AnyCodableValue].self) { self = .array(v) }
        else if let v = try? container.decode([String: AnyCodableValue].self) { self = .dictionary(v) }
        else if container.decodeNil() { self = .null }
        else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unsupported type")) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .dictionary(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }

    // Helper accessors
    var stringValue: String? {
        if case .string(let v) = self { return v }
        return nil
    }
    var intValue: Int? {
        if case .int(let v) = self { return v }
        return nil
    }
    var doubleValue: Double? {
        if case .double(let v) = self { return v }
        if case .int(let v) = self { return Double(v) }
        return nil
    }
    var boolValue: Bool? {
        if case .bool(let v) = self { return v }
        return nil
    }

    static func from(_ encodable: some Encodable) -> AnyCodableValue {
        guard let data = try? JSONEncoder().encode(encodable),
              let value = try? JSONDecoder().decode(AnyCodableValue.self, from: data) else {
            return .null
        }
        return value
    }
}
```

- [ ] **Step 2: Verify Types.swift compiles**

Run: `swiftc -parse native/swift/Types.swift`
Expected: No errors (syntax check only, no output binary)

- [ ] **Step 3: Commit**

```bash
git add native/swift/Types.swift
git commit -m "feat(native): add Swift JSON-RPC protocol types"
```

---

### Task 2: Swift Main Loop + Ping Handler

**Files:**
- Create: `native/swift/main.swift`

stdin read loop, JSON parsing, method routing, stdout response writing. Starts with `ping` as the only method — other methods are stubbed.

- [ ] **Step 1: Create main.swift**

```swift
// native/swift/main.swift
import Foundation

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
```

- [ ] **Step 2: Verify both files compile together**

Run: `swiftc -parse native/swift/Types.swift native/swift/main.swift`
Expected: No errors

- [ ] **Step 3: Build a test binary and verify ping**

Run:
```bash
mkdir -p ~/.spectra/bin
swiftc native/swift/Types.swift native/swift/main.swift \
  -framework Foundation -framework ApplicationServices \
  -o ~/.spectra/bin/spectra-native
echo '{"id":1,"method":"ping"}' | ~/.spectra/bin/spectra-native
```
Expected: `{"id":1,"result":{"pong":true}}`

- [ ] **Step 4: Commit**

```bash
git add native/swift/main.swift
git commit -m "feat(native): add Swift main loop with ping + method dispatch"
```

---

### Task 3: AppTarget — App Discovery

**Files:**
- Create: `native/swift/AppTarget.swift`

Find running macOS apps by name, return PID.

- [ ] **Step 1: Create AppTarget.swift**

```swift
// native/swift/AppTarget.swift
import Foundation
import AppKit

struct AppInfo {
    let pid: pid_t
    let name: String
    let bundleIdentifier: String?
}

func findApp(name: String) -> AppInfo? {
    let apps = NSWorkspace.shared.runningApplications
    // Try exact match first (case-insensitive)
    if let app = apps.first(where: { $0.localizedName?.lowercased() == name.lowercased() }) {
        return AppInfo(
            pid: app.processIdentifier,
            name: app.localizedName ?? name,
            bundleIdentifier: app.bundleIdentifier
        )
    }
    // Try contains match
    if let app = apps.first(where: { $0.localizedName?.lowercased().contains(name.lowercased()) == true }) {
        return AppInfo(
            pid: app.processIdentifier,
            name: app.localizedName ?? name,
            bundleIdentifier: app.bundleIdentifier
        )
    }
    return nil
}

func getAppPid(from params: [String: AnyCodableValue]?) -> Result<pid_t, String> {
    guard let params = params else {
        return .failure("Missing params")
    }

    // Direct PID
    if let pid = params["pid"]?.intValue {
        return .success(pid_t(pid))
    }

    // App name lookup
    if let name = params["app"]?.stringValue {
        guard let app = findApp(name: name) else {
            return .failure("App not running: \(name). Launch it first.")
        }
        return .success(app.pid)
    }

    return .failure("Provide 'app' (name) or 'pid' (number)")
}
```

- [ ] **Step 2: Rebuild binary and test**

Run:
```bash
swiftc native/swift/Types.swift native/swift/main.swift native/swift/AppTarget.swift \
  -framework Foundation -framework ApplicationServices -framework AppKit \
  -o ~/.spectra/bin/spectra-native
```
Expected: Compiles without error

- [ ] **Step 3: Commit**

```bash
git add native/swift/AppTarget.swift
git commit -m "feat(native): add app discovery via NSRunningApplication"
```

---

## Chunk 2: Swift AX Bridge

### Task 4: AXBridge — AX Tree Walking + Snapshot

**Files:**
- Create: `native/swift/AXBridge.swift`

Walks the AXUIElement tree for a macOS app and returns `NativeElement[]`. Also handles `act` and `find`.

- [ ] **Step 1: Create AXBridge.swift**

```swift
// native/swift/AXBridge.swift
import Foundation
import ApplicationServices

// ─── Role → Action Mapping ────────────────────────────────

func inferActions(role: String) -> [String] {
    switch role {
    case "AXButton", "AXLink", "AXCheckBox", "AXSwitch",
         "AXRadioButton", "AXTab", "AXMenuItem":
        return ["press"]
    case "AXTextField", "AXTextArea":
        return ["setValue"]
    case "AXSlider":
        return ["increment", "decrement"]
    case "AXPopUpButton", "AXComboBox":
        return ["press", "showMenu"]
    default:
        return []
    }
}

// ─── AX Tree Walking ──────────────────────────────────────

func walkAXTree(element: AXUIElement, path: [Int] = [], depth: Int = 0, maxDepth: Int = 20) -> [NativeElement] {
    guard depth < maxDepth else { return [] }

    var elements: [NativeElement] = []

    // Get role
    var roleRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef)
    let role = (roleRef as? String) ?? "AXUnknown"

    // Skip non-useful roles
    let skipRoles: Set<String> = ["AXWindow", "AXApplication", "AXScrollArea", "AXSplitGroup", "AXLayoutArea"]
    let isSkipped = skipRoles.contains(role)

    if !isSkipped {
        // Get label (title or description)
        var titleRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &titleRef)
        var descRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXDescriptionAttribute as CFString, &descRef)
        let label = (titleRef as? String) ?? (descRef as? String) ?? ""

        // Get value
        var valueRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valueRef)
        let value = valueRef.flatMap { $0 as? String }

        // Get enabled
        var enabledRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXEnabledAttribute as CFString, &enabledRef)
        let enabled = (enabledRef as? Bool) ?? true

        // Get focused
        var focusedRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXFocusedAttribute as CFString, &focusedRef)
        let focused = (focusedRef as? Bool) ?? false

        // Get bounds (position + size)
        var posRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef)
        var sizeRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef)

        var bounds: [Double] = [0, 0, 0, 0]
        if let posValue = posRef {
            var point = CGPoint.zero
            AXValueGetValue(posValue as! AXValue, .cgPoint, &point)
            bounds[0] = Double(point.x)
            bounds[1] = Double(point.y)
        }
        if let sizeValue = sizeRef {
            var size = CGSize.zero
            AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
            bounds[2] = Double(size.width)
            bounds[3] = Double(size.height)
        }

        let actions = inferActions(role: role)

        // Only include elements that have a label or are interactive
        if !label.isEmpty || !actions.isEmpty {
            elements.append(NativeElement(
                role: role,
                label: label,
                value: value,
                enabled: enabled,
                focused: focused,
                actions: actions,
                bounds: bounds,
                path: path
            ))
        }
    }

    // Walk children
    var childrenRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef)
    if let children = childrenRef as? [AXUIElement] {
        for (index, child) in children.enumerated() {
            let childPath = path + [index]
            elements.append(contentsOf: walkAXTree(element: child, path: childPath, depth: depth + 1, maxDepth: maxDepth))
        }
    }

    return elements
}

// ─── Get Window Info ──────────────────────────────────────

func getWindowInfo(pid: pid_t) -> WindowInfo? {
    let app = AXUIElementCreateApplication(pid)
    var windowsRef: CFTypeRef?
    AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef)

    guard let windows = windowsRef as? [AXUIElement], let window = windows.first else {
        return nil
    }

    var titleRef: CFTypeRef?
    AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleRef)
    let title = (titleRef as? String) ?? ""

    var posRef: CFTypeRef?
    AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &posRef)
    var sizeRef: CFTypeRef?
    AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeRef)

    var bounds: [Double] = [0, 0, 0, 0]
    if let posValue = posRef {
        var point = CGPoint.zero
        AXValueGetValue(posValue as! AXValue, .cgPoint, &point)
        bounds[0] = Double(point.x)
        bounds[1] = Double(point.y)
    }
    if let sizeValue = sizeRef {
        var size = CGSize.zero
        AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
        bounds[2] = Double(size.width)
        bounds[3] = Double(size.height)
    }

    // Get window ID via CGWindowListCopyWindowInfo
    var windowId: Int = 0
    let windowList = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    for w in windowList {
        if let ownerPid = w[kCGWindowOwnerPID as String] as? pid_t,
           ownerPid == pid,
           let wid = w[kCGWindowNumber as String] as? Int {
            windowId = wid
            break
        }
    }

    return WindowInfo(id: windowId, title: title, bounds: bounds)
}

// ─── Snapshot ─────────────────────────────────────────────

func snapshotApp(pid: pid_t) -> Result<SnapshotResult, String> {
    let app = AXUIElementCreateApplication(pid)

    // Verify we can access this app
    var roleRef: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(app, kAXRoleAttribute as CFString, &roleRef)
    guard result == .success else {
        if result == .apiDisabled {
            return .failure("Accessibility permission not granted. Open System Settings → Privacy & Security → Accessibility and add Terminal (or your IDE).")
        }
        return .failure("Cannot access app (PID \(pid)). Error: \(result.rawValue)")
    }

    let elements = walkAXTree(element: app)

    guard let window = getWindowInfo(pid: pid) else {
        return .failure("No window found for app (PID \(pid))")
    }

    return .success(SnapshotResult(elements: elements, window: window))
}

// ─── Perform Action ───────────────────────────────────────

func navigateToElement(app: AXUIElement, path: [Int]) -> AXUIElement? {
    var current = app
    for index in path {
        var childrenRef: CFTypeRef?
        AXUIElementCopyAttributeValue(current, kAXChildrenAttribute as CFString, &childrenRef)
        guard let children = childrenRef as? [AXUIElement], index < children.count else {
            return nil
        }
        current = children[index]
    }
    return current
}

func performAction(pid: pid_t, elementPath: [Int], action: String, value: String?) -> Result<Bool, String> {
    let app = AXUIElementCreateApplication(pid)

    guard let element = navigateToElement(app: app, path: elementPath) else {
        return .failure("Element not found at path \(elementPath)")
    }

    switch action {
    case "press":
        let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if result != .success {
            return .failure("Press action failed: \(result.rawValue)")
        }
        return .success(true)

    case "setValue":
        guard let value = value else {
            return .failure("setValue requires a value parameter")
        }
        let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
        if result != .success {
            // Fallback: try focused typing
            AXUIElementPerformAction(element, kAXPressAction as CFString)
            return .failure("setValue failed: \(result.rawValue)")
        }
        return .success(true)

    case "increment":
        let result = AXUIElementPerformAction(element, kAXIncrementAction as CFString)
        if result != .success {
            return .failure("Increment failed: \(result.rawValue)")
        }
        return .success(true)

    case "decrement":
        let result = AXUIElementPerformAction(element, kAXDecrementAction as CFString)
        if result != .success {
            return .failure("Decrement failed: \(result.rawValue)")
        }
        return .success(true)

    case "showMenu":
        let result = AXUIElementPerformAction(element, kAXShowMenuAction as CFString)
        if result != .success {
            return .failure("ShowMenu failed: \(result.rawValue)")
        }
        return .success(true)

    default:
        return .failure("Unknown action: \(action)")
    }
}

// ─── Find Elements ────────────────────────────────────────

func findElements(pid: pid_t, role: String?, label: String?) -> [NativeElement] {
    let app = AXUIElementCreateApplication(pid)
    let allElements = walkAXTree(element: app)

    return allElements.filter { el in
        var matches = true
        if let role = role {
            matches = matches && el.role.lowercased() == role.lowercased()
        }
        if let label = label {
            matches = matches && el.label.lowercased().contains(label.lowercased())
        }
        return matches
    }
}

// AXBridge provides the implementation functions above.
// main.swift will be updated in Step 2 to call these directly.
```

- [ ] **Step 2: Update main.swift to call AXBridge functions**

Replace the snapshot/act/find stubs in `native/swift/main.swift`:

```swift
// Replace these stubs in main.swift:

func handleSnapshot(_ req: Request) {
    switch getAppPid(from: req.params) {
    case .success(let pid):
        switch snapshotApp(pid: pid) {
        case .success(let result):
            sendResult(id: req.id, AnyCodableValue.from(result))
        case .failure(let msg):
            sendError(id: req.id, code: -1, message: msg)
        }
    case .failure(let msg):
        sendError(id: req.id, code: -1, message: msg)
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
        case .failure(let msg):
            sendResult(id: req.id, .dictionary(["success": .bool(false), "error": .string(msg)]))
        }
    case .failure(let msg):
        sendError(id: req.id, code: -1, message: msg)
    }
}

func handleFind(_ req: Request) {
    switch getAppPid(from: req.params) {
    case .success(let pid):
        let role = req.params?["role"]?.stringValue
        let label = req.params?["label"]?.stringValue
        let elements = findElements(pid: pid, role: role, label: label)
        sendResult(id: req.id, AnyCodableValue.from(elements))
    case .failure(let msg):
        sendError(id: req.id, code: -1, message: msg)
    }
}
```

- [ ] **Step 3: Rebuild and verify compilation**

Run:
```bash
swiftc native/swift/Types.swift native/swift/main.swift \
  native/swift/AppTarget.swift native/swift/AXBridge.swift \
  -framework Foundation -framework ApplicationServices -framework AppKit \
  -framework CoreGraphics \
  -o ~/.spectra/bin/spectra-native
```
Expected: Compiles without error

- [ ] **Step 4: Manual smoke test against Finder**

Run:
```bash
echo '{"id":1,"method":"snapshot","params":{"app":"Finder"}}' | ~/.spectra/bin/spectra-native 2>/dev/null
```
Expected: JSON output with `"elements"` array containing Finder's AX tree elements

- [ ] **Step 5: Commit**

```bash
git add native/swift/AXBridge.swift native/swift/main.swift
git commit -m "feat(native): add AX tree walking, action execution, and element search"
```

---

### Task 5: Build Scripts + TypeScript Compiler Module

**Files:**
- Modify: `package.json`
- Create: `src/native/compiler.ts`
- Create: `tests/native/compiler.test.ts`

- [ ] **Step 1: Add build scripts to package.json**

Add to the `"scripts"` section of `package.json`:

```json
"build:native": "node -e \"const{execSync}=require('child_process');const{mkdirSync}=require('fs');mkdirSync(require('os').homedir()+'/.spectra/bin',{recursive:true});execSync('swiftc native/swift/Types.swift native/swift/main.swift native/swift/AppTarget.swift native/swift/AXBridge.swift -framework Foundation -framework ApplicationServices -framework AppKit -framework CoreGraphics -o '+require('os').homedir()+'/.spectra/bin/spectra-native',{stdio:'inherit'})\"",
"build:test-app": "node -e \"const{execSync}=require('child_process');execSync('swiftc native/swift/TestApp/TestApp.swift -framework SwiftUI -framework AppKit -o '+require('os').homedir()+'/.spectra/bin/spectra-test-app',{stdio:'inherit'})\""
```

- [ ] **Step 2: Create compiler.ts**

```typescript
// src/native/compiler.ts
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readdirSync } from 'node:fs'

const BIN_DIR = join(homedir(), '.spectra', 'bin')
const BINARY_PATH = join(BIN_DIR, 'spectra-native')
const HASH_PATH = join(BIN_DIR, '.source-hash')
const TEST_APP_PATH = join(BIN_DIR, 'spectra-test-app')

// Find project root by looking for native/swift/ directory
function findSwiftSource(): string {
  // Walk up from this file's location to find the project root
  let dir = resolve(import.meta.dirname, '..', '..')
  const swiftDir = join(dir, 'native', 'swift')
  if (!existsSync(swiftDir)) {
    throw new Error(`Swift source not found at ${swiftDir}`)
  }
  return swiftDir
}

function getSwiftFiles(swiftDir: string, exclude?: string): string[] {
  return readdirSync(swiftDir)
    .filter(f => f.endsWith('.swift'))
    .filter(f => !exclude || !f.includes(exclude))
    .map(f => join(swiftDir, f))
    .sort()
}

function computeSourceHash(files: string[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(readFileSync(file))
  }
  return hash.digest('hex')
}

export function isStale(): boolean {
  if (!existsSync(BINARY_PATH)) return true
  if (!existsSync(HASH_PATH)) return true

  const swiftDir = findSwiftSource()
  const files = getSwiftFiles(swiftDir)
  const currentHash = computeSourceHash(files)
  const storedHash = readFileSync(HASH_PATH, 'utf-8').trim()

  return currentHash !== storedHash
}

export function compile(): void {
  const swiftDir = findSwiftSource()
  const files = getSwiftFiles(swiftDir)

  // Ensure bin directory exists
  mkdirSync(BIN_DIR, { recursive: true })

  // Check for swiftc
  try {
    execSync('which swiftc', { stdio: 'pipe' })
  } catch {
    throw new Error(
      'swiftc not found. Install Xcode Command Line Tools:\n'
      + '  xcode-select --install'
    )
  }

  const frameworks = [
    '-framework', 'Foundation',
    '-framework', 'ApplicationServices',
    '-framework', 'AppKit',
    '-framework', 'CoreGraphics',
  ]

  const cmd = ['swiftc', ...files, ...frameworks, '-o', BINARY_PATH].join(' ')

  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr?.toString() ?? err.message : String(err)
    throw new Error(`Swift compilation failed:\n${msg}`)
  }

  // Write source hash
  const hash = computeSourceHash(files)
  writeFileSync(HASH_PATH, hash)
}

export function ensureBinary(): string {
  if (isStale()) {
    compile()
  }
  return BINARY_PATH
}

export function compileTestApp(): string {
  const swiftDir = findSwiftSource()
  const testAppDir = join(swiftDir, 'TestApp')

  if (!existsSync(testAppDir)) {
    throw new Error(`Test app source not found at ${testAppDir}`)
  }

  mkdirSync(BIN_DIR, { recursive: true })

  const files = readdirSync(testAppDir)
    .filter(f => f.endsWith('.swift'))
    .map(f => join(testAppDir, f))

  const cmd = [
    'swiftc', ...files,
    '-framework', 'SwiftUI',
    '-framework', 'AppKit',
    '-o', TEST_APP_PATH,
  ].join(' ')

  execSync(cmd, { stdio: 'pipe' })
  return TEST_APP_PATH
}

export { BINARY_PATH, BIN_DIR, TEST_APP_PATH }
```

- [ ] **Step 3: Create compiler.test.ts**

```typescript
// tests/native/compiler.test.ts
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { isStale, compile, ensureBinary, BINARY_PATH } from '../../src/native/compiler.js'

describe('compiler', () => {
  it('compiles the Swift binary', () => {
    compile()
    expect(existsSync(BINARY_PATH)).toBe(true)
  })

  it('reports not stale after fresh compile', () => {
    expect(isStale()).toBe(false)
  })

  it('ensureBinary returns path to binary', () => {
    const path = ensureBinary()
    expect(path).toBe(BINARY_PATH)
    expect(existsSync(path)).toBe(true)
  })
})
```

- [ ] **Step 4: Run compiler tests**

Run: `npx vitest run tests/native/compiler.test.ts`
Expected: 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add package.json src/native/compiler.ts tests/native/compiler.test.ts
git commit -m "feat(native): add Swift binary compiler with source hash caching"
```

---

## Chunk 3: TypeScript Bridge + NativeDriver

### Task 6: NativeBridge — Subprocess + JSON-RPC

**Files:**
- Create: `src/native/bridge.ts`
- Create: `tests/native/bridge.test.ts`

- [ ] **Step 1: Create bridge.ts**

```typescript
// src/native/bridge.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { ensureBinary } from './compiler.js'

const REQUEST_TIMEOUT_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 30_000
const HEARTBEAT_TIMEOUT_MS = 2_000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  method: string
}

export class NativeBridge {
  private process: ChildProcess | null = null
  private readline: Interface | null = null
  private nextId = 0
  private pending = new Map<number, PendingRequest>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private _ready = false

  get ready(): boolean {
    return this._ready && this.process !== null && !this.process.killed
  }

  async start(): Promise<void> {
    if (this.ready) return

    const binaryPath = ensureBinary()
    this.process = spawn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.on('exit', (code) => {
      this._ready = false
      // Reject all pending requests
      for (const [, req] of this.pending) {
        clearTimeout(req.timer)
        req.reject(new Error('Native process exited unexpectedly'))
      }
      this.pending.clear()
    })

    // Pipe stderr to debug log
    this.process.stderr?.on('data', (data: Buffer) => {
      // Could log to file or debug output
    })

    // Set up line-based JSON reading from stdout
    this.readline = createInterface({ input: this.process.stdout! })
    this.readline.on('line', (line) => this.handleLine(line))

    // Verify the binary is responsive
    this._ready = true
    await this.send<{ pong: boolean }>('ping')

    // Start heartbeat
    this.startHeartbeat()
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ready) {
      await this.start()
    }

    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(
            `Native request '${method}' timed out after ${REQUEST_TIMEOUT_MS / 1000}s. `
            + 'The target app may be unresponsive.'
          ))
        }
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        method,
      })

      const msg: Record<string, unknown> = { id, method }
      if (params) msg.params = params
      this.process!.stdin!.write(JSON.stringify(msg) + '\n')
    })
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let data: any
    try {
      data = JSON.parse(trimmed)
    } catch {
      return // Ignore non-JSON lines
    }

    if ('id' in data && this.pending.has(data.id)) {
      const { resolve, reject, timer } = this.pending.get(data.id)!
      clearTimeout(timer)
      this.pending.delete(data.id)

      if (data.error) {
        reject(new Error(`Native error ${data.error.code}: ${data.error.message}`))
      } else {
        resolve(data.result)
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      try {
        await Promise.race([
          this.send('ping'),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Heartbeat timeout')), HEARTBEAT_TIMEOUT_MS)
          ),
        ])
      } catch {
        // Heartbeat failed — restart
        await this.restart()
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private async restart(): Promise<void> {
    this.stopHeartbeat()
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this._ready = false
    await this.start()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  async close(): Promise<void> {
    this.stopHeartbeat()

    // Clear all pending
    for (const [, req] of this.pending) {
      clearTimeout(req.timer)
    }
    this.pending.clear()

    if (this.process) {
      // Try graceful shutdown
      try {
        this.process.stdin!.write(JSON.stringify({ id: 0, method: 'quit' }) + '\n')
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            this.process?.kill()
            resolve()
          }, 2000)
          this.process!.on('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      } catch {
        this.process.kill()
      }
      this.process = null
    }
    this._ready = false
  }
}

// Singleton bridge shared across sessions
let sharedBridge: NativeBridge | null = null

export function getSharedBridge(): NativeBridge {
  if (!sharedBridge) {
    sharedBridge = new NativeBridge()
  }
  return sharedBridge
}
```

- [ ] **Step 2: Create bridge.test.ts**

```typescript
// tests/native/bridge.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { NativeBridge } from '../../src/native/bridge.js'

describe('NativeBridge', () => {
  const bridge = new NativeBridge()

  afterAll(async () => {
    await bridge.close()
  })

  it('starts the Swift binary and responds to ping', async () => {
    await bridge.start()
    expect(bridge.ready).toBe(true)

    const result = await bridge.send<{ pong: boolean }>('ping')
    expect(result.pong).toBe(true)
  })

  it('returns error for unknown methods', async () => {
    await expect(bridge.send('nonexistent.method')).rejects.toThrow('Unknown method')
  })

  it('handles concurrent requests', async () => {
    const [r1, r2, r3] = await Promise.all([
      bridge.send<{ pong: boolean }>('ping'),
      bridge.send<{ pong: boolean }>('ping'),
      bridge.send<{ pong: boolean }>('ping'),
    ])
    expect(r1.pong).toBe(true)
    expect(r2.pong).toBe(true)
    expect(r3.pong).toBe(true)
  })

  it('auto-starts on send if not started', async () => {
    const fresh = new NativeBridge()
    const result = await fresh.send<{ pong: boolean }>('ping')
    expect(result.pong).toBe(true)
    await fresh.close()
  })
})
```

- [ ] **Step 3: Run bridge tests**

Run: `npx vitest run tests/native/bridge.test.ts`
Expected: 4 tests pass (requires compiled Swift binary)

- [ ] **Step 4: Commit**

```bash
git add src/native/bridge.ts tests/native/bridge.test.ts
git commit -m "feat(native): add NativeBridge subprocess manager with JSON-RPC"
```

---

### Task 7: NativeDriver — Implements Driver

**Files:**
- Create: `src/native/driver.ts`

- [ ] **Step 1: Create driver.ts**

```typescript
// src/native/driver.ts
import type { Driver, DriverTarget, Snapshot, ActionType, ActResult, Element } from '../core/types.js'
import { normalizeRole } from '../core/normalize.js'
import { NativeBridge, getSharedBridge } from './bridge.js'
import { readFile } from 'node:fs/promises'

interface NativeElement {
  role: string
  label: string
  value: string | null
  enabled: boolean
  focused: boolean
  actions: string[]
  bounds: [number, number, number, number]
  path: number[]
}

interface WindowInfo {
  id: number
  title: string
  bounds: [number, number, number, number]
}

interface SnapshotResponse {
  elements: NativeElement[]
  window: WindowInfo
}

export class NativeDriver implements Driver {
  private bridge: NativeBridge
  private appName: string | null = null
  private appPid: number | null = null
  private windowId: number | null = null
  private idToPath = new Map<string, number[]>()

  constructor(bridge?: NativeBridge) {
    this.bridge = bridge ?? getSharedBridge()
  }

  async connect(target: DriverTarget): Promise<void> {
    if (!target.appName) {
      throw new Error('NativeDriver requires appName in target')
    }
    this.appName = target.appName

    // Verify the app is accessible by taking a snapshot
    await this.bridge.start()
    const result = await this.bridge.send<SnapshotResponse>('snapshot', { app: this.appName })
    this.windowId = result.window.id
  }

  async snapshot(): Promise<Snapshot> {
    const params: Record<string, unknown> = {}
    if (this.appPid) params.pid = this.appPid
    else if (this.appName) params.app = this.appName

    const result = await this.bridge.send<SnapshotResponse>('snapshot', params)

    // Map NativeElement[] to Element[] with sequential IDs
    this.idToPath.clear()
    const elements: Element[] = result.elements.map((nel, i) => {
      const id = `e${i + 1}`
      this.idToPath.set(id, nel.path)
      return {
        id,
        role: normalizeRole(nel.role, 'macos'),
        label: nel.label,
        value: nel.value,
        enabled: nel.enabled,
        focused: nel.focused,
        actions: nel.actions,
        bounds: nel.bounds as [number, number, number, number],
        parent: null,
      }
    })

    return {
      appName: this.appName ?? undefined,
      platform: 'macos',
      elements,
      timestamp: Date.now(),
      metadata: {
        elementCount: elements.length,
      },
    }
  }

  async act(elementId: string, action: ActionType, value?: string): Promise<ActResult> {
    const path = this.idToPath.get(elementId)
    if (!path) {
      return {
        success: false,
        error: `Element '${elementId}' not found. Take a new snapshot — the UI may have changed.`,
        snapshot: await this.snapshot(),
      }
    }

    // Map ActionType to native action names
    const nativeAction = action === 'click' ? 'press'
      : action === 'type' ? 'setValue'
      : action === 'clear' ? 'setValue'
      : action

    const params: Record<string, unknown> = {
      app: this.appName,
      elementPath: path,
      action: nativeAction,
    }
    if (action === 'type' && value) params.value = value
    if (action === 'clear') params.value = ''

    try {
      const result = await this.bridge.send<{ success: boolean; error?: string }>('act', params)
      const snapshot = await this.snapshot()

      if (!result.success) {
        return { success: false, error: result.error, snapshot }
      }
      return { success: true, snapshot }
    } catch (err) {
      const snapshot = await this.snapshot()
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        snapshot,
      }
    }
  }

  async screenshot(): Promise<Buffer> {
    const result = await this.bridge.send<{ path: string }>('screenshot', { app: this.appName })
    return readFile(result.path)
  }

  async close(): Promise<void> {
    this.appName = null
    this.appPid = null
    this.windowId = null
    this.idToPath.clear()
    // Don't close bridge — shared across sessions
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/native/driver.ts
git commit -m "feat(native): add NativeDriver implementing Driver interface"
```

---

## Chunk 4: Test App + Integration Tests

### Task 8: SwiftUI Test App

**Files:**
- Create: `native/swift/TestApp/TestApp.swift`

- [ ] **Step 1: Create TestApp.swift**

```swift
// native/swift/TestApp/TestApp.swift
import SwiftUI

@main
struct SpectraTestApp: App {
    var body: some Scene {
        WindowGroup("Spectra Test") {
            TabView {
                ControlsTab()
                    .tabItem { Label("Controls", systemImage: "slider.horizontal.3") }
                ListsTab()
                    .tabItem { Label("Lists", systemImage: "list.bullet") }
                FormsTab()
                    .tabItem { Label("Forms", systemImage: "doc.text") }
            }
            .frame(minWidth: 400, minHeight: 300)
        }
    }
}

// ─── Tab 1: Controls ──────────────────────────────────────

struct ControlsTab: View {
    @State private var clickCount = 0
    @State private var textValue = ""
    @State private var isDarkMode = false
    @State private var sliderValue = 50.0

    var body: some View {
        VStack(spacing: 16) {
            Button("Click Me") {
                clickCount += 1
            }
            .accessibilityIdentifier("spectra.controls.clickButton")

            Text("Clicked: \(clickCount)")
                .accessibilityIdentifier("spectra.controls.clickCount")

            TextField("Enter text", text: $textValue)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("spectra.controls.textField")

            Toggle("Dark Mode", isOn: $isDarkMode)
                .accessibilityIdentifier("spectra.controls.darkModeSwitch")

            HStack {
                Text("Slider: \(Int(sliderValue))")
                Slider(value: $sliderValue, in: 0...100)
                    .accessibilityIdentifier("spectra.controls.slider")
            }
        }
        .padding()
    }
}

// ─── Tab 2: Lists ─────────────────────────────────────────

struct ListsTab: View {
    var body: some View {
        List {
            ForEach(1...5, id: \.self) { i in
                HStack {
                    Text("Item \(i)")
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundColor(.secondary)
                }
                .accessibilityIdentifier("spectra.lists.item\(i)")
            }
        }
    }
}

// ─── Tab 3: Forms ─────────────────────────────────────────

struct FormsTab: View {
    @State private var name = ""
    @State private var email = ""
    @State private var country = "US"

    let countries = ["US", "UK", "CA"]

    var body: some View {
        Form {
            TextField("Name", text: $name)
                .accessibilityIdentifier("spectra.forms.nameField")

            TextField("Email", text: $email)
                .accessibilityIdentifier("spectra.forms.emailField")

            Picker("Country", selection: $country) {
                ForEach(countries, id: \.self) { c in
                    Text(c).tag(c)
                }
            }
            .accessibilityIdentifier("spectra.forms.countryPicker")

            Button("Submit") {
                // no-op for testing
            }
            .accessibilityIdentifier("spectra.forms.submitButton")
        }
        .padding()
    }
}
```

- [ ] **Step 2: Build the test app**

Run:
```bash
mkdir -p ~/.spectra/bin
swiftc native/swift/TestApp/TestApp.swift \
  -framework SwiftUI -framework AppKit \
  -o ~/.spectra/bin/spectra-test-app
```
Expected: Compiles without error

- [ ] **Step 3: Manual smoke test — launch and verify**

Run: `~/.spectra/bin/spectra-test-app &` then verify a window titled "Spectra Test" appears. Kill with `kill %1`.

- [ ] **Step 4: Commit**

```bash
git add native/swift/TestApp/TestApp.swift
git commit -m "feat(native): add SwiftUI test fixture app with known elements"
```

---

### Task 9: NativeDriver Integration Tests

**Files:**
- Create: `tests/native/driver.test.ts`

Tests launch the test app, automate it via NativeDriver, then kill it.

- [ ] **Step 1: Create driver.test.ts**

```typescript
// tests/native/driver.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { NativeDriver } from '../../src/native/driver.js'
import { NativeBridge } from '../../src/native/bridge.js'
import { TEST_APP_PATH } from '../../src/native/compiler.js'
import { existsSync } from 'node:fs'

// Skip if binaries not built
const hasBinaries = existsSync(TEST_APP_PATH)

describe.skipIf(!hasBinaries)('NativeDriver', () => {
  let testApp: ChildProcess
  let bridge: NativeBridge
  let driver: NativeDriver

  beforeAll(async () => {
    // Launch test app
    testApp = spawn(TEST_APP_PATH, [], { stdio: 'ignore' })
    // Wait for app to launch and become accessible
    await new Promise(r => setTimeout(r, 2000))

    bridge = new NativeBridge()
    driver = new NativeDriver(bridge)
    await driver.connect({ appName: 'Spectra Test' })
  }, 15000)

  afterAll(async () => {
    await driver.close()
    await bridge.close()
    testApp?.kill()
    // Wait for cleanup
    await new Promise(r => setTimeout(r, 500))
  })

  it('connects to the test app', () => {
    // connect() succeeded in beforeAll — just verify we got here
    expect(true).toBe(true)
  })

  it('takes a snapshot with elements', async () => {
    const snap = await driver.snapshot()

    expect(snap.platform).toBe('macos')
    expect(snap.appName).toBe('Spectra Test')
    expect(snap.elements.length).toBeGreaterThan(0)

    // Should find the "Click Me" button
    const clickBtn = snap.elements.find(e => e.label === 'Click Me')
    expect(clickBtn).toBeDefined()
    expect(clickBtn!.role).toBe('button')
    expect(clickBtn!.actions).toContain('press')
  })

  it('finds the text field', async () => {
    const snap = await driver.snapshot()
    const textField = snap.elements.find(e => e.role === 'textfield')
    expect(textField).toBeDefined()
  })

  it('clicks a button', async () => {
    const snap = await driver.snapshot()
    const clickBtn = snap.elements.find(e => e.label === 'Click Me')
    expect(clickBtn).toBeDefined()

    const result = await driver.act(clickBtn!.id, 'click')
    expect(result.success).toBe(true)

    // Counter should have incremented
    const afterSnap = result.snapshot
    const counter = afterSnap.elements.find(e => e.label?.includes('Clicked:'))
    expect(counter).toBeDefined()
    expect(counter!.label).toContain('1')
  })

  it('takes a screenshot', async () => {
    const buf = await driver.screenshot()
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(0)
    // PNG header
    expect(buf[0]).toBe(0x89)
    expect(buf[1]).toBe(0x50) // P
  })

  it('returns error for stale element ID', async () => {
    const result = await driver.act('e999', 'click')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run tests/native/driver.test.ts`
Expected: 6 tests pass (or skip if binaries not built)

- [ ] **Step 3: Commit**

```bash
git add tests/native/driver.test.ts
git commit -m "test(native): add NativeDriver integration tests against test app"
```

---

## Chunk 5: Simulator Support

### Task 10: SimBridge — xcrun simctl Wrappers

**Files:**
- Create: `native/swift/SimBridge.swift`

- [ ] **Step 1: Create SimBridge.swift**

```swift
// native/swift/SimBridge.swift
import Foundation

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

func simScreenshot(udid: String, mask: String? = nil) -> Result<String, String> {
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
        return .failure("simctl screenshot failed: \(error)")
    }

    if process.terminationStatus != 0 {
        return .failure("simctl screenshot exited with code \(process.terminationStatus)")
    }

    return .success(tmpPath)
}

// ─── simctl Video Recording ───────────────────────────────

var activeRecordings: [String: Process] = [:]

func simStartRecording(udid: String) -> Result<String, String> {
    let tmpPath = NSTemporaryDirectory() + "spectra-sim-\(UUID().uuidString).mp4"

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["simctl", "io", udid, "recordVideo", tmpPath]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice

    do {
        try process.run()
    } catch {
        return .failure("simctl recordVideo failed: \(error)")
    }

    let recordingId = UUID().uuidString
    activeRecordings[recordingId] = process
    return .success(recordingId)
}

func simStopRecording(recordingId: String) -> Result<String, String> {
    guard let process = activeRecordings[recordingId] else {
        return .failure("Recording not found: \(recordingId)")
    }

    process.interrupt() // SIGINT — simctl stops recording gracefully
    process.waitUntilExit()
    activeRecordings.removeValue(forKey: recordingId)

    // Get the path from the arguments
    guard let args = process.arguments, let path = args.last else {
        return .failure("Could not determine recording output path")
    }

    return .success(path)
}

// ─── simctl Tap ───────────────────────────────────────────

func simTap(udid: String, x: Int, y: Int) -> Result<Bool, String> {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["simctl", "io", udid, "tap", String(x), String(y)]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice

    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        return .failure("simctl tap failed: \(error)")
    }

    return .success(process.terminationStatus == 0)
}

// ─── Method Handlers ──────────────────────────────────────
// These replace the stubs in main.swift

// (will be wired in the main.swift update step)
```

- [ ] **Step 2: Update main.swift sim stubs to call SimBridge functions**

Replace sim stubs in `native/swift/main.swift`:

```swift
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
    case .failure(let msg):
        sendError(id: req.id, code: -1, message: msg)
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
        case .failure(let msg):
            sendError(id: req.id, code: -1, message: msg)
        }
    } else if action == "stop" {
        guard let recordingId = params["recordingId"]?.stringValue else {
            sendError(id: req.id, code: -1, message: "Missing recordingId for stop")
            return
        }
        switch simStopRecording(recordingId: recordingId) {
        case .success(let path):
            sendResult(id: req.id, .dictionary(["path": .string(path)]))
        case .failure(let msg):
            sendError(id: req.id, code: -1, message: msg)
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
    case .failure(let msg):
        sendResult(id: req.id, .dictionary(["success": .bool(false), "error": .string(msg)]))
    }
}
```

- [ ] **Step 3: Rebuild binary**

Run: `npm run build:native`
Expected: Compiles without error

- [ ] **Step 4: Commit**

```bash
git add native/swift/SimBridge.swift native/swift/main.swift
git commit -m "feat(native): add simulator support (simctl devices, screenshot, record, tap)"
```

---

### Task 11: SimDriver + Platform Detection Update

**Files:**
- Create: `src/native/sim.ts`
- Modify: `src/mcp/context.ts`
- Modify: `src/mcp/tools/connect.ts`

- [ ] **Step 1: Create sim.ts**

```typescript
// src/native/sim.ts
import type { Driver, DriverTarget, Snapshot, ActionType, ActResult, Element } from '../core/types.js'
import { NativeBridge, getSharedBridge } from './bridge.js'
import { readFile } from 'node:fs/promises'

interface SimDevice {
  udid: string
  name: string
  state: string
  runtime: string
}

export class SimDriver implements Driver {
  private bridge: NativeBridge
  private deviceId: string | null = null
  private platform: 'ios' | 'watchos' = 'ios'

  constructor(bridge?: NativeBridge) {
    this.bridge = bridge ?? getSharedBridge()
  }

  async connect(target: DriverTarget): Promise<void> {
    if (!target.deviceId) {
      throw new Error('SimDriver requires deviceId in target')
    }

    await this.bridge.start()

    // Look up the device
    const result = await this.bridge.send<{ devices: SimDevice[] }>('simDevices')
    const name = target.deviceId.toLowerCase()
    const booted = result.devices.filter(d => d.state === 'Booted')
    const device = booted.find(d => d.name.toLowerCase().includes(name))

    if (!device) {
      const available = booted.map(d => d.name).join(', ')
      throw new Error(
        `No booted simulator matching '${target.deviceId}'.`
        + (available ? ` Available: ${available}` : ' No simulators are booted.')
        + `\nRun: xcrun simctl boot "${target.deviceId}"`
      )
    }

    this.deviceId = device.udid
    this.platform = device.runtime.includes('watchOS') ? 'watchos' : 'ios'
  }

  async snapshot(): Promise<Snapshot> {
    // Simulators have limited AX access — return minimal snapshot
    // For iOS, we could walk the Simulator.app AX tree in the future
    return {
      platform: this.platform,
      elements: [],
      timestamp: Date.now(),
      metadata: {
        elementCount: 0,
        timedOut: false,
      },
    }
  }

  async act(elementId: string, action: ActionType, value?: string): Promise<ActResult> {
    // Coordinate-based tap only for simulators
    return {
      success: false,
      error: 'Simulator automation uses coordinate-based taps via spectra_capture. Element-based actions are limited.',
      snapshot: await this.snapshot(),
    }
  }

  async tap(x: number, y: number): Promise<{ success: boolean }> {
    return this.bridge.send('simTap', { deviceId: this.deviceId, x, y })
  }

  async screenshot(): Promise<Buffer> {
    const mask = this.platform === 'watchos' ? 'black' : undefined
    const params: Record<string, unknown> = { deviceId: this.deviceId }
    if (mask) params.mask = mask
    const result = await this.bridge.send<{ path: string }>('simScreenshot', params)
    return readFile(result.path)
  }

  async close(): Promise<void> {
    this.deviceId = null
  }
}
```

- [ ] **Step 2: Update context.ts**

Replace the full file `src/mcp/context.ts`:

```typescript
// src/mcp/context.ts
import { SessionManager } from '../core/session.js'
import type { Driver, Platform } from '../core/types.js'

export interface ToolContext {
  sessions: SessionManager
  drivers: Map<string, Driver>
}

export function createContext(): ToolContext {
  return {
    sessions: new SessionManager(),
    drivers: new Map(),
  }
}

export interface PlatformInfo {
  platform: Platform
  driverType: 'cdp' | 'native' | 'sim'
}

export function detectPlatform(target: string): PlatformInfo {
  if (/^https?:\/\//.test(target)) {
    return { platform: 'web', driverType: 'cdp' }
  }
  if (target.startsWith('sim:')) {
    const device = target.slice(4).toLowerCase()
    const platform: Platform = device.includes('watch') ? 'watchos' : 'ios'
    return { platform, driverType: 'sim' }
  }
  return { platform: 'macos', driverType: 'native' }
}
```

- [ ] **Step 3: Update connect.ts**

Replace the full file `src/mcp/tools/connect.ts`:

```typescript
// src/mcp/tools/connect.ts
import type { ToolContext } from '../context.js'
import { detectPlatform } from '../context.js'
import { CdpDriver } from '../../cdp/driver.js'
import { NativeDriver } from '../../native/driver.js'
import { SimDriver } from '../../native/sim.js'
import { serializeSnapshot } from '../../core/serialize.js'
import type { Driver, DriverTarget } from '../../core/types.js'

export interface ConnectParams {
  target: string
  name?: string
  record?: boolean
}

export interface ConnectResult {
  sessionId: string
  platform: string
  elementCount: number
  snapshot: string
}

export async function handleConnect(
  params: ConnectParams,
  ctx: ToolContext,
  createDriver?: () => Driver,
): Promise<ConnectResult> {
  const { platform, driverType } = detectPlatform(params.target)

  // Build driver target
  const driverTarget: DriverTarget = {}
  if (platform === 'web') {
    driverTarget.url = params.target
  } else if (platform === 'macos') {
    driverTarget.appName = params.target
  } else {
    driverTarget.deviceId = params.target.replace(/^sim:/, '')
  }

  // Create session
  const session = await ctx.sessions.create({
    name: params.name,
    platform,
    target: driverTarget,
  })

  // Create and connect driver
  const driver = createDriver
    ? createDriver()
    : driverType === 'cdp' ? new CdpDriver()
    : driverType === 'native' ? new NativeDriver()
    : new SimDriver()

  await driver.connect(driverTarget)
  ctx.drivers.set(session.id, driver)

  // Get initial snapshot
  const snap = await driver.snapshot()
  const serialized = serializeSnapshot(snap)

  return {
    sessionId: session.id,
    platform,
    elementCount: snap.elements.length,
    snapshot: serialized,
  }
}
```

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `npx vitest run`
Expected: All existing 125 tests still pass. (MCP tool tests use mock drivers so context.ts type change should be transparent.)

- [ ] **Step 5: Commit**

```bash
git add src/native/sim.ts src/mcp/context.ts src/mcp/tools/connect.ts
git commit -m "feat(native): add SimDriver + update platform detection and driver routing"
```

---

### Task 12: Simulator Integration Tests

**Files:**
- Create: `tests/native/sim.test.ts`

- [ ] **Step 1: Create sim.test.ts**

```typescript
// tests/native/sim.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { NativeBridge } from '../../src/native/bridge.js'
import { existsSync } from 'node:fs'
import { BINARY_PATH } from '../../src/native/compiler.js'

const hasBinary = existsSync(BINARY_PATH)

describe.skipIf(!hasBinary)('SimDriver', () => {
  const bridge = new NativeBridge()

  afterAll(async () => {
    await bridge.close()
  })

  it('lists simulator devices', async () => {
    await bridge.start()
    const result = await bridge.send<{ devices: Array<{ udid: string; name: string; state: string; runtime: string }> }>('simDevices')

    expect(result.devices).toBeDefined()
    expect(Array.isArray(result.devices)).toBe(true)
    // Should have at least some devices if Xcode is installed
    // (may be empty in CI — just verify structure)
    if (result.devices.length > 0) {
      const device = result.devices[0]
      expect(device.udid).toBeDefined()
      expect(device.name).toBeDefined()
      expect(device.state).toBeDefined()
      expect(device.runtime).toBeDefined()
    }
  })
})
```

- [ ] **Step 2: Run sim tests**

Run: `npx vitest run tests/native/sim.test.ts`
Expected: 1 test passes (or skips if binary not built)

- [ ] **Step 3: Commit**

```bash
git add tests/native/sim.test.ts
git commit -m "test(native): add simulator integration test"
```

---

## Chunk 6: Media Module + Final Wiring

### Task 13: FFmpeg Detection + MediaCapture (Swift)

**Files:**
- Create: `src/media/ffmpeg.ts`
- Create: `native/swift/MediaCapture.swift`

- [ ] **Step 1: Create ffmpeg.ts**

```typescript
// src/media/ffmpeg.ts
import { execSync, spawn, type ChildProcess } from 'node:child_process'

let cachedFfmpegPath: string | null | undefined = undefined

export function detectFfmpeg(): string | null {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath
  try {
    const path = execSync('which ffmpeg', { stdio: 'pipe' }).toString().trim()
    cachedFfmpegPath = path || null
  } catch {
    cachedFfmpegPath = null
  }
  return cachedFfmpegPath
}

export function requireFfmpeg(): string {
  const path = detectFfmpeg()
  if (!path) {
    throw new Error(
      'ffmpeg not found. Video recording requires ffmpeg.\n'
      + 'Install: brew install ffmpeg'
    )
  }
  return path
}

export async function transcode(
  input: string,
  output: string,
  options?: { crf?: number },
): Promise<void> {
  const ffmpeg = requireFfmpeg()
  const crf = options?.crf ?? 23

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      '-i', input,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', String(crf),
      '-y', // overwrite
      output,
    ], { stdio: 'pipe' })

    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })

    proc.on('error', (err) => reject(err))
  })
}
```

- [ ] **Step 2: Create MediaCapture.swift**

```swift
// native/swift/MediaCapture.swift
import Foundation
import ScreenCaptureKit

// ─── Window Screenshot (screencapture) ────────────────────

func captureWindowScreenshot(windowId: Int) -> Result<String, String> {
    let tmpPath = NSTemporaryDirectory() + "spectra-ss-\(UUID().uuidString).png"

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    process.arguments = ["-l", String(windowId), "-x", tmpPath]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice

    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        return .failure("screencapture failed: \(error)")
    }

    if process.terminationStatus != 0 {
        return .failure("screencapture exited with code \(process.terminationStatus)")
    }

    return .success(tmpPath)
}

// ─── Method Handler ───────────────────────────────────────
// Replaces stub in main.swift
```

- [ ] **Step 3: Update main.swift screenshot handler**

Replace screenshot stub in `native/swift/main.swift`:

```swift
func handleScreenshot(_ req: Request) {
    switch getAppPid(from: req.params) {
    case .success(let pid):
        guard let window = getWindowInfo(pid: pid) else {
            sendError(id: req.id, code: -1, message: "No window found for app")
            return
        }
        switch captureWindowScreenshot(windowId: window.id) {
        case .success(let path):
            sendResult(id: req.id, .dictionary(["path": .string(path), "format": .string("png")]))
        case .failure(let msg):
            sendError(id: req.id, code: -1, message: msg)
        }
    case .failure(let msg):
        sendError(id: req.id, code: -1, message: msg)
    }
}

func handleStartRecording(_ req: Request) {
    // ScreenCaptureKit recording — Phase 2 stretch goal
    // For now, return not implemented
    sendError(id: req.id, code: -1, message: "macOS video recording via ScreenCaptureKit: coming in Phase 3a")
}

func handleStopRecording(_ req: Request) {
    sendError(id: req.id, code: -1, message: "No active recording")
}
```

- [ ] **Step 4: Rebuild binary**

Run: `npm run build:native`
Expected: Compiles without error

- [ ] **Step 5: Commit**

```bash
git add src/media/ffmpeg.ts native/swift/MediaCapture.swift native/swift/main.swift
git commit -m "feat(media): add ffmpeg detection + native window screenshot"
```

---

### Task 14: Unified MediaCapture + RecordHandle

**Files:**
- Create: `src/media/capture.ts`
- Create: `src/media/recorder.ts`

- [ ] **Step 1: Create capture.ts**

```typescript
// src/media/capture.ts
import type { Driver, Platform } from '../core/types.js'
import { NativeBridge, getSharedBridge } from '../native/bridge.js'
import { readFile } from 'node:fs/promises'
import type { RecordHandle } from './recorder.js'
import { SimRecordHandle } from './recorder.js'

export interface ScreenshotOptions {
  format?: 'png' | 'jpeg'
}

export interface ScreenshotResult {
  buffer: Buffer
  path?: string
  format: string
}

export async function screenshot(
  driver: Driver,
  platform: Platform,
  options?: ScreenshotOptions,
): Promise<ScreenshotResult> {
  const buf = await driver.screenshot()
  return {
    buffer: buf,
    format: options?.format ?? 'png',
  }
}

export async function startRecording(
  platform: Platform,
  deviceId?: string,
): Promise<RecordHandle> {
  if (platform === 'ios' || platform === 'watchos') {
    if (!deviceId) throw new Error('deviceId required for simulator recording')
    const bridge = getSharedBridge()
    const result = await bridge.send<{ recordingId: string }>('simRecord', {
      deviceId,
      action: 'start',
    })
    return new SimRecordHandle(bridge, result.recordingId, deviceId)
  }

  throw new Error(`Video recording not yet supported for platform: ${platform}`)
}
```

- [ ] **Step 2: Create recorder.ts**

```typescript
// src/media/recorder.ts
import type { NativeBridge } from '../native/bridge.js'
import { unlink } from 'node:fs/promises'

export interface RecordHandle {
  stop(): Promise<string>   // path to final video
  cancel(): Promise<void>   // discard
}

export class SimRecordHandle implements RecordHandle {
  constructor(
    private bridge: NativeBridge,
    private recordingId: string,
    private deviceId: string,
  ) {}

  async stop(): Promise<string> {
    const result = await this.bridge.send<{ path: string }>('simRecord', {
      deviceId: this.deviceId,
      action: 'stop',
      recordingId: this.recordingId,
    })
    return result.path
  }

  async cancel(): Promise<void> {
    try {
      const path = await this.stop()
      await unlink(path).catch(() => {})
    } catch {
      // Already stopped or failed — ignore
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/media/capture.ts src/media/recorder.ts
git commit -m "feat(media): add unified MediaCapture API and RecordHandle"
```

---

### Task 15: Update handleCapture + Media Tests

**Files:**
- Modify: `src/mcp/tools/capture.ts`
- Create: `tests/media/capture.test.ts`
- Create: `tests/media/recorder.test.ts`

- [ ] **Step 1: Update capture.ts MCP handler**

Replace the full file `src/mcp/tools/capture.ts`:

```typescript
// src/mcp/tools/capture.ts
import type { ToolContext } from '../context.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getStoragePath } from '../../core/storage.js'
import { screenshot } from '../../media/capture.js'

export interface CaptureParams {
  sessionId: string
  type: 'screenshot' | 'start_recording' | 'stop_recording'
}

export interface CaptureResult {
  path?: string
  format?: string
  error?: string
}

export async function handleCapture(params: CaptureParams, ctx: ToolContext): Promise<CaptureResult> {
  const driver = ctx.drivers.get(params.sessionId)
  if (!driver) throw new Error(`Session ${params.sessionId} not found`)

  const session = ctx.sessions.get(params.sessionId)
  const platform = session?.platform ?? 'web'

  if (params.type === 'screenshot') {
    const result = await screenshot(driver, platform)
    const filename = `capture-${Date.now()}.${result.format}`
    const dir = join(getStoragePath(), 'sessions', params.sessionId)
    await mkdir(dir, { recursive: true })
    const path = join(dir, filename)
    await writeFile(path, result.buffer)

    return { path, format: result.format }
  }

  if (params.type === 'start_recording' || params.type === 'stop_recording') {
    return { error: 'Video recording available in Phase 3a for web. Use sim: targets for simulator recording.' }
  }

  return { error: `Unknown capture type: ${params.type}` }
}
```

- [ ] **Step 2: Create capture.test.ts**

```typescript
// tests/media/capture.test.ts
import { describe, it, expect } from 'vitest'
import { detectFfmpeg } from '../../src/media/ffmpeg.js'

describe('ffmpeg', () => {
  it('detects ffmpeg presence', () => {
    const path = detectFfmpeg()
    // May be null if ffmpeg not installed — just verify it returns string or null
    expect(path === null || typeof path === 'string').toBe(true)
  })
})
```

- [ ] **Step 3: Create recorder.test.ts (placeholder)**

```typescript
// tests/media/recorder.test.ts
import { describe, it, expect } from 'vitest'

describe('RecordHandle', () => {
  it('is importable', async () => {
    const { SimRecordHandle } = await import('../../src/media/recorder.js')
    expect(SimRecordHandle).toBeDefined()
  })
})
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (125 existing + new integration + media tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/capture.ts tests/media/capture.test.ts tests/media/recorder.test.ts
git commit -m "feat(media): update capture handler + add media tests"
```

---

## Post-Implementation Checklist

After all tasks are complete:

- [ ] Run `npm run build:native` — verify Swift binary compiles
- [ ] Run `npm run build:test-app` — verify test app compiles
- [ ] Run `npx vitest run` — verify all tests pass
- [ ] Run `echo '{"id":1,"method":"ping"}' | ~/.spectra/bin/spectra-native` — verify ping
- [ ] Manually test: launch test app → snapshot → click button → verify counter increments
- [ ] Verify `npm run build` (TypeScript compilation) succeeds
