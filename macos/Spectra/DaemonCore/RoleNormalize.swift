// macos/Spectra/DaemonCore/RoleNormalize.swift
//
// M3.G2 (S2) — AX role normalization. Ports src/core/normalize.ts
// `normalizeRole` verbatim: two flat lookup tables (web AX/ARIA role names,
// macOS AXRole constants) collapsed to Spectra's small cross-platform role
// vocabulary, with 'group' as the universal fallback. NativeDriver's
// snapshot() calls this per-element (parity target: src/native/driver.ts:66,
// `normalizeRole(nel.role, 'macos')`).
//
// The web table is kept even though G2's NativeDriver only ever normalizes
// against `.macos` (DriverPlatform's doc comment: full TS vocabulary is kept
// for forward parity — M4's CdpDriver will need the web table verbatim, and
// splitting this file's tables now vs. later is pure churn).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

enum RoleNormalize {
    /// Mirrors `WEB_ROLES` in src/core/normalize.ts verbatim.
    private static let webRoles: [String: String] = [
        "button": "button", "textbox": "textfield", "TextField": "textfield",
        "link": "link", "checkbox": "checkbox", "switch": "switch", "slider": "slider",
        "tab": "tab", "combobox": "select", "listbox": "select",
        "heading": "heading", "img": "image", "image": "image", "StaticText": "text",
        "group": "group", "generic": "group", "navigation": "group", "main": "group",
        "contentinfo": "group", "banner": "group", "form": "group", "search": "group",
        "region": "group", "article": "group", "section": "group", "complementary": "group",
    ]

    /// Mirrors `MACOS_ROLES` in src/core/normalize.ts verbatim.
    private static let macosRoles: [String: String] = [
        "AXButton": "button", "AXTextField": "textfield", "AXTextArea": "textfield",
        "AXLink": "link", "AXCheckBox": "checkbox", "AXSwitch": "switch", "AXSlider": "slider",
        "AXTab": "tab", "AXRadioButton": "tab", "AXPopUpButton": "select", "AXComboBox": "select",
        "AXStaticText": "text", "AXImage": "image", "AXGroup": "group", "AXWindow": "group",
        "AXScrollArea": "group", "AXToolbar": "group", "AXSplitGroup": "group",
        "AXList": "group", "AXOutline": "group", "AXTable": "group",
        "AXRow": "group", "AXColumn": "group", "AXCell": "group",
    ]

    /// Ports `normalizeRole(rawRole, platform)` from src/core/normalize.ts:
    /// web uses ARIA-ish role names; iOS/watchOS share macOS's AX role naming
    /// convention (TS comment, verbatim). Unknown roles fall back to 'group'
    /// (never throws — an unrecognized AX role is a display/grouping
    /// decision, not an error).
    static func normalizeRole(_ rawRole: String, platform: DriverPlatform) -> String {
        if platform == .web { return webRoles[rawRole] ?? "group" }
        return macosRoles[rawRole] ?? "group"
    }
}
