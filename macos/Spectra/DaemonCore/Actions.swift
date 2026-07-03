// macos/Spectra/DaemonCore/Actions.swift
//
// M3.G2 (S3, step-intelligence-engine) — action selection. Port of
// src/core/actions.ts: given an already-resolved DriverElement, decide WHICH
// DriverActionType to perform (and what value, if any) for a step/navigation
// purpose. Pure, deterministic, driver-agnostic — takes no Driver, does no
// I/O, calls no LLM. Consumed by StepOps.swift (step/llmStep) and
// Intelligence.swift's crawl (navigation-purpose action selection for
// discover).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

// ─── Types ───────────────────────────────────────────────────────────────────

enum ActionPurpose {
    case step
    case navigation
}

struct ActionSelectionOptions {
    var intent: String?
    var purpose: ActionPurpose = .step
    var allowFormSubmit: Bool = false

    init(intent: String? = nil, purpose: ActionPurpose = .step, allowFormSubmit: Bool = false) {
        self.intent = intent
        self.purpose = purpose
        self.allowFormSubmit = allowFormSubmit
    }
}

/// Mirrors actions.ts `ActionSelection`.
struct ActionSelection {
    var action: DriverActionType
    var value: String?
    var reason: String
}

// ─── Role sets (mirror actions.ts's TEXT_INPUT_ROLES/SELECT_ROLES/CLICK_ROLES) ─

private let textInputRoles: Set<String> = ["textbox", "textfield", "textarea", "searchbox"]
private let selectRolesActions: Set<String> = ["combobox", "listbox", "option", "menuitem"]
private let clickRoles: Set<String> = [
    "button", "link", "tab", "menuitem", "checkbox", "radio", "switch", "option",
]

// ─── Regex helpers (file-scoped; Resolve.swift/Intelligence.swift each keep
// their own copies — a shared helper file is not part of this W0 slice's
// fixed 6-file ownership boundary) ──────────────────────────────────────────

private func regexTest(_ pattern: String, _ text: String, caseInsensitive: Bool = true) -> Bool {
    var opts: String.CompareOptions = [.regularExpression]
    if caseInsensitive { opts.insert(.caseInsensitive) }
    return text.range(of: pattern, options: opts) != nil
}

private func firstCaptureGroup(
    _ pattern: String,
    _ text: String,
    options: NSRegularExpression.Options = []
) -> String? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let m = regex.firstMatch(in: text, options: [], range: range), m.numberOfRanges > 1,
          let r = Range(m.range(at: 1), in: text) else { return nil }
    return String(text[r])
}

// Mirrors actions.ts FORM_SUBMIT_PATTERN / DESTRUCTIVE_PATTERN (kept as raw
// pattern strings + `regexTest` rather than precompiled NSRegularExpression —
// consistent with the rest of this file's lightweight regex helpers).
private let formSubmitPattern =
    "\\b(submit|save|send|sign ?in|log ?in|login|register|sign ?up|checkout|pay|purchase|confirm)\\b"
private let destructivePattern =
    "\\b(delete|remove|destroy|archive|reset|clear|discard|sign ?out|log ?out|logout|deactivate)\\b"

// ─── Public API (mirrors actions.ts exports) ────────────────────────────────

func extractActionValue(_ intent: String) -> String? {
    if let r = firstCaptureGroup("\"([^\"]+)\"", intent) { return r }
    if let r = firstCaptureGroup("'([^']+)'", intent) { return r }
    if let r = firstCaptureGroup(
        "\\b(?:type|enter|fill|write)\\s+(.+?)\\s+\\b(?:into|in|on)\\b",
        intent,
        options: [.caseInsensitive]
    ) {
        return r.trimmingCharacters(in: .whitespaces)
    }
    return nil
}

func inferActionFromIntent(_ intent: String) -> DriverActionType {
    let lower = intent.lowercased()
    if regexTest("\\b(clear|empty|erase)\\b", lower) { return .clear }
    if regexTest("\\b(type|enter|fill|write|input)\\b", lower) { return .type }
    if regexTest("\\b(scroll|swipe)\\b", lower) { return .scroll }
    if regexTest("\\b(hover|mouse over)\\b", lower) { return .hover }
    if regexTest("\\b(focus)\\b", lower) { return .focus }
    if regexTest("\\b(select|choose|pick)\\b", lower) { return .select }
    return .click
}

func isPotentiallyUnsafeForNavigation(_ element: DriverElement) -> Bool {
    let text = "\(element.role) \(element.label) \(element.value ?? "")"
    return regexTest(destructivePattern, text) || regexTest(formSubmitPattern, text)
}

func isElementVisible(_ element: DriverElement) -> Bool {
    element.bounds.width > 0 && element.bounds.height > 0
}

func isElementActionable(_ element: DriverElement) -> Bool {
    if !element.enabled { return false }
    if element.actions.isEmpty && !clickRoles.contains(normalizeRole(element.role)) { return false }
    return true
}

/// Mirrors actions.ts `selectActionForElement`.
func selectActionForElement(
    _ element: DriverElement,
    options: ActionSelectionOptions = ActionSelectionOptions()
) -> ActionSelection? {
    guard isElementActionable(element) else { return nil }

    if options.purpose == .navigation {
        if !options.allowFormSubmit && isPotentiallyUnsafeForNavigation(element) { return nil }
        return selectNavigationAction(element)
    }

    let requested = options.intent.map { inferActionFromIntent($0) }
    let value = options.intent.flatMap { extractActionValue($0) }

    if let requested, supportsAction(element, requested) {
        return ActionSelection(action: requested, value: value, reason: "intent:\(requested.rawValue)")
    }

    if requested == .select, supportsAction(element, .click) {
        return ActionSelection(action: .click, value: value, reason: "select-fallback-click")
    }

    if let requested, (requested == .type || requested == .clear), supportsAction(element, .focus) {
        return ActionSelection(action: .focus, value: nil, reason: "\(requested.rawValue)-fallback-focus")
    }

    return selectNavigationAction(element)
}

private func selectNavigationAction(_ element: DriverElement) -> ActionSelection? {
    let role = normalizeRole(element.role)

    if selectRolesActions.contains(role), supportsAction(element, .select) {
        return ActionSelection(action: .select, value: nil, reason: "role-select")
    }
    if supportsAction(element, .click) {
        return ActionSelection(action: .click, value: nil, reason: "default-click")
    }
    if supportsAction(element, .select) {
        return ActionSelection(action: .select, value: nil, reason: "fallback-select")
    }
    return nil
}

func supportsAction(_ element: DriverElement, _ action: DriverActionType) -> Bool {
    let role = normalizeRole(element.role)
    let actions = Set(element.actions.map { $0.lowercased() })

    switch action {
    case .click:
        return actions.contains("click") || actions.contains("press") || actions.contains("showmenu")
            || clickRoles.contains(role)
    case .type, .clear:
        return actions.contains("type") || actions.contains("setvalue") || textInputRoles.contains(role)
    case .select:
        return actions.contains("select") || actions.contains("showmenu") || selectRolesActions.contains(role)
    case .scroll:
        return actions.contains("scroll") || role == "scrollbar"
    case .hover, .focus:
        return !actions.isEmpty || clickRoles.contains(role) || textInputRoles.contains(role)
    }
}

/// Mirrors actions.ts's local `normalizeRole`: lowercase, strip a leading
/// "ax" prefix (AXButton-style raw AX roles -> "button"). Intelligence.swift
/// and Resolve.swift each keep an identical file-private copy — this exact
/// helper is duplicated 3x in the TS source too (actions.ts/resolve.ts/
/// navigation.ts each declare their own), so the duplication here mirrors
/// the original, not a shortcut.
func normalizeRole(_ role: String) -> String {
    var r = role.lowercased()
    if r.hasPrefix("ax") { r.removeFirst(2) }
    return r
}
