// native/swift/AXBridge.swift
import Foundation
import ApplicationServices

// ─── Error Types ──────────────────────────────────────────

struct AXBridgeError: Error {
    let message: String
}

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

func walkAXTree(element: AXUIElement, path: [Int] = [], depth: Int = 0, maxDepth: Int = 10) -> [NativeElement] {
    guard depth < maxDepth else { return [] }

    var elements: [NativeElement] = []

    // Get role
    var roleRef: CFTypeRef?
    let roleResult = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef)
    guard roleResult == .success else {
        return [] // Skip elements we can't read
    }
    let role = (roleRef as? String) ?? "AXUnknown"

    // Skip non-useful container roles and menu bar elements
    // Note: AXWindow must NOT be skipped — we need to traverse into windows to find content
    // Note: AXScrollArea, AXSplitGroup must NOT be skipped — they contain UI content
    let skipRoles: Set<String> = ["AXApplication", "AXMenuBar", "AXMenuBarItem", "AXMenu", "AXMenuItem"]
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

func snapshotApp(pid: pid_t) -> Result<SnapshotResult, AXBridgeError> {
    let app = AXUIElementCreateApplication(pid)

    // Verify we can access this app
    var roleRef: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(app, kAXRoleAttribute as CFString, &roleRef)
    guard result == .success else {
        if result == .apiDisabled {
            return .failure(AXBridgeError(message: "Accessibility permission not granted. Open System Settings → Privacy & Security → Accessibility and add Terminal (or your IDE)."))
        }
        return .failure(AXBridgeError(message: "Cannot access app (PID \(pid)). Error: \(result.rawValue)"))
    }

    // Walk the entire app tree - the walkAXTree function will filter out menu bars
    let elements = walkAXTree(element: app)

    guard let window = getWindowInfo(pid: pid) else {
        return .failure(AXBridgeError(message: "No window found for app (PID \(pid))"))
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

func performAction(pid: pid_t, elementPath: [Int], action: String, value: String?) -> Result<Bool, AXBridgeError> {
    let app = AXUIElementCreateApplication(pid)

    guard let element = navigateToElement(app: app, path: elementPath) else {
        return .failure(AXBridgeError(message: "Element not found at path \(elementPath)"))
    }

    switch action {
    case "press":
        let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if result != .success {
            return .failure(AXBridgeError(message: "Press action failed: \(result.rawValue)"))
        }
        return .success(true)

    case "setValue":
        guard let value = value else {
            return .failure(AXBridgeError(message: "setValue requires a value parameter"))
        }
        let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
        if result != .success {
            // Fallback: try focused typing
            AXUIElementPerformAction(element, kAXPressAction as CFString)
            return .failure(AXBridgeError(message: "setValue failed: \(result.rawValue)"))
        }
        return .success(true)

    case "increment":
        let result = AXUIElementPerformAction(element, kAXIncrementAction as CFString)
        if result != .success {
            return .failure(AXBridgeError(message: "Increment failed: \(result.rawValue)"))
        }
        return .success(true)

    case "decrement":
        let result = AXUIElementPerformAction(element, kAXDecrementAction as CFString)
        if result != .success {
            return .failure(AXBridgeError(message: "Decrement failed: \(result.rawValue)"))
        }
        return .success(true)

    case "showMenu":
        let result = AXUIElementPerformAction(element, kAXShowMenuAction as CFString)
        if result != .success {
            return .failure(AXBridgeError(message: "ShowMenu failed: \(result.rawValue)"))
        }
        return .success(true)

    default:
        return .failure(AXBridgeError(message: "Unknown action: \(action)"))
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
