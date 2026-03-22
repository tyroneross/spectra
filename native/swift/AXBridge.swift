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

// Roles to skip entirely (don't add as elements, but still walk children for non-menu roles)
private let menuRoles: Set<String> = ["AXMenuBar", "AXMenuBarItem", "AXMenu", "AXMenuItem"]

// Task 3: Known macOS window traffic light button labels (system chrome — never app-controlled)
private let systemChromeLabels: Set<String> = ["close", "minimize", "zoom", "full screen",
                                                "close button", "minimize button", "zoom button",
                                                "full screen button"]

// Task 3: Returns true if this element is a system chrome button that should be filtered out
private func isSystemChromeButton(role: String, label: String, bounds: [Double]) -> Bool {
    guard role == "AXButton" else { return false }
    let lower = label.lowercased()
    guard systemChromeLabels.contains(lower) else { return false }
    // Safety net: only filter small buttons (traffic lights are ~14×14, cap at 16)
    let width = bounds[2], height = bounds[3]
    return width <= 16 || height <= 16
}

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

    // Skip menu bar hierarchy entirely (don't even walk children)
    if menuRoles.contains(role) { return [] }

    // Skip AXApplication children to prevent circular references
    // macOS 26 reports AXApplication as child of itself — detect and skip
    if role == "AXApplication" && depth > 0 { return [] }

    let isContainer = role == "AXApplication" || role == "AXWindow" || role == "AXGroup"
        || role == "AXScrollArea" || role == "AXSplitGroup" || role == "AXLayoutArea"
        || role == "AXTabGroup"

    if !isContainer {
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

        // Task 3: Skip system chrome buttons (traffic lights) — they are never app-controlled
        let skipSystemChrome = isSystemChromeButton(role: role, label: label, bounds: bounds)

        // Only include elements that have a label or are interactive, and are not filtered system chrome
        if !skipSystemChrome && (!label.isEmpty || !actions.isEmpty) {
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

    // Walk children (standard traversal)
    // Task 1: While walking, record window keys seen via kAXChildrenAttribute so the
    // kAXWindowsAttribute fallback below can skip duplicates.
    var seenWindowKeys: Set<String> = []
    var childrenRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef)
    if let children = childrenRef as? [AXUIElement] {
        for (index, child) in children.enumerated() {
            // Task 1: Track AXWindow children so the fallback doesn't re-walk them
            var childRoleRef: CFTypeRef?
            AXUIElementCopyAttributeValue(child, kAXRoleAttribute as CFString, &childRoleRef)
            if (childRoleRef as? String) == "AXWindow" {
                var winTitleRef: CFTypeRef?
                AXUIElementCopyAttributeValue(child, kAXTitleAttribute as CFString, &winTitleRef)
                let winTitle = (winTitleRef as? String) ?? ""
                var winPosRef: CFTypeRef?
                var winSizeRef: CFTypeRef?
                AXUIElementCopyAttributeValue(child, kAXPositionAttribute as CFString, &winPosRef)
                AXUIElementCopyAttributeValue(child, kAXSizeAttribute as CFString, &winSizeRef)
                var pt = CGPoint.zero; var sz = CGSize.zero
                if let pv = winPosRef { AXValueGetValue(pv as! AXValue, .cgPoint, &pt) }
                if let sv = winSizeRef { AXValueGetValue(sv as! AXValue, .cgSize, &sz) }
                let key = "\(winTitle)|\(pt.x),\(pt.y),\(sz.width),\(sz.height)"
                seenWindowKeys.insert(key)
            }

            let childPath = path + [index]
            elements.append(contentsOf: walkAXTree(element: child, path: childPath, depth: depth + 1, maxDepth: maxDepth))
        }
    }

    // For AXApplication at root, also try kAXWindowsAttribute as fallback
    // macOS 26 may not include windows in kAXChildrenAttribute
    if role == "AXApplication" && depth == 0 {
        var windowsRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &windowsRef)
        if let windows = windowsRef as? [AXUIElement] {
            for (index, win) in windows.enumerated() {
                // Only walk if the window has role AXWindow (skip if it reports AXApplication — circular ref)
                var winRoleRef: CFTypeRef?
                AXUIElementCopyAttributeValue(win, kAXRoleAttribute as CFString, &winRoleRef)
                let winRole = (winRoleRef as? String) ?? ""
                guard winRole == "AXWindow" else { continue }

                // Task 1: Skip windows already seen in kAXChildrenAttribute traversal
                var winTitleRef: CFTypeRef?
                AXUIElementCopyAttributeValue(win, kAXTitleAttribute as CFString, &winTitleRef)
                let winTitle = (winTitleRef as? String) ?? ""
                var winPosRef: CFTypeRef?
                var winSizeRef: CFTypeRef?
                AXUIElementCopyAttributeValue(win, kAXPositionAttribute as CFString, &winPosRef)
                AXUIElementCopyAttributeValue(win, kAXSizeAttribute as CFString, &winSizeRef)
                var pt = CGPoint.zero; var sz = CGSize.zero
                if let pv = winPosRef { AXValueGetValue(pv as! AXValue, .cgPoint, &pt) }
                if let sv = winSizeRef { AXValueGetValue(sv as! AXValue, .cgSize, &sz) }
                let key = "\(winTitle)|\(pt.x),\(pt.y),\(sz.width),\(sz.height)"
                if seenWindowKeys.contains(key) { continue }

                let winPath = [index]
                elements.append(contentsOf: walkAXTree(element: win, path: winPath, depth: depth + 1, maxDepth: maxDepth))
            }
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
