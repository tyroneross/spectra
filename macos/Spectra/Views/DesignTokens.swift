// DesignTokens.swift
//
// Centralized typography and color tokens for Spectra's macOS UI.
//
// Visual register: Aurora Glass (see .ibr/ui-guidance/active.md).
// Aurora Glass is the lighter sibling of Aurora Deep — refined translucent
// surfaces over a near-black neutral background, indigo accent, no ambient
// animation. The register's own guidance:
//
//   "Use Aurora Glass when the interface is one of many tools the user
//   switches between — it should feel refined but not immersive."
//
// That's Spectra: a menu-bar utility you reach for between coding bursts.
//
// Calm Precision principle 3 (three-line hierarchy) and HIG accessibility
// require Dynamic-Type-aware text styles, not hardcoded point sizes. Color
// usage routes through semantic Aurora Glass tokens, with system-color
// fallbacks where vibrancy must adapt to the host window.
//
// Consume these throughout the Views/ layer instead of inline
// `.font(.system(size: 11))` or `Color.gray.opacity(0.08)`.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

// MARK: - Typography tokens (Dynamic-Type-aware)
//
// macOS body default = 13pt SF Pro. These map to SwiftUI's semantic font roles
// so they scale with the user's accessibility text-size preference.
//
// Aurora Glass typography scale (translated to SwiftUI semantic fonts):
//   Title 17px/600  →  .body + .semibold
//   Body  13-14px   →  .callout (default)
//   Body emphasized →  .callout + .medium
//   Small 12px      →  .footnote
//   Micro 10-11px   →  .caption / .caption2

enum SpectraText {
    /// Section title in a popover / sheet header. 13–15pt semibold.
    static let title: Font = .system(.body, design: .default).weight(.semibold)

    /// Primary body line — repo name, button labels in compact context. 12–13pt.
    static let body: Font = .system(.callout, design: .default)

    /// Emphasized body — the prominent line in a row. Same size as body, medium weight.
    static let bodyEmphasized: Font = .system(.callout, design: .default).weight(.medium)

    /// Secondary descriptive copy under a title. 11–12pt.
    static let description: Font = .system(.footnote, design: .default)

    /// Tertiary metadata — paths, counts, status pills. 10–11pt.
    static let metadata: Font = .system(.caption, design: .default)

    /// Smallest annotation — used sparingly for inline tags. 10pt.
    static let micro: Font = .system(.caption2, design: .default)
}

// MARK: - Aurora Glass accent palette
//
// Indigo primary, with success/warning/danger from the natural Aurora set.
// All tokens are Color values so they compose cleanly with .opacity() and
// .blendMode() at the call site without re-importing the palette.

enum SpectraAccent {
    /// Primary accent — actions, focus rings, active nav. Aurora Glass `--accent`.
    /// Hex: #818cf8 (indigo-400-ish).
    static let primary: Color = Color(red: 0x81 / 255, green: 0x8c / 255, blue: 0xf8 / 255)

    /// Soft glow background derived from `primary` at 15% alpha.
    /// Used for active-state backgrounds and focus rings.
    static let primaryGlow: Color = Color(red: 0x81 / 255, green: 0x8c / 255, blue: 0xf8 / 255).opacity(0.15)

    /// Success / connected / ready. Aurora `--green` (#34d399).
    static let success: Color = Color(red: 0x34 / 255, green: 0xd3 / 255, blue: 0x99 / 255)

    /// Warning / caution. Aurora `--amber` (#fbbf24).
    static let warning: Color = Color(red: 0xfb / 255, green: 0xbf / 255, blue: 0x24 / 255)

    /// Error / destructive. Aurora `--rose` (#fb7185).
    static let danger: Color = Color(red: 0xfb / 255, green: 0x71 / 255, blue: 0x85 / 255)
}

// MARK: - Semantic surface tokens
//
// Map to system materials/colors so they adapt to light/dark/high-contrast
// while expressing Aurora Glass's translucent intent. The popover background
// is owned by the host NSPopover (system material) — these tokens layer ON
// TOP of that vibrancy.
//
// Never hardcode `Color.gray.opacity(0.08)` directly in a view — use these.

enum SpectraSurface {
    /// Subtle background for grouped content (recents list, selected-repo card).
    /// Aurora Glass `--surface` = rgba(255,255,255,0.03) over the dark field.
    static let subtle: Color = Color.white.opacity(0.03)

    /// Hover state for interactive subtle surfaces.
    /// Aurora Glass `--surface-hover` = rgba(255,255,255,0.06).
    static let subtleHover: Color = Color.white.opacity(0.06)

    /// Slightly stronger background for emphasized regions (banner, callout).
    /// Aurora Glass `--glass` = rgba(255,255,255,0.04).
    static let raised: Color = Color.white.opacity(0.04)

    /// Warning-tinted background for "needs attention" cards (helper offline).
    /// Aurora amber at low alpha keeps the glass register coherent.
    static let warning: Color = SpectraAccent.warning.opacity(0.10)

    /// Error-tinted background for error toasts.
    static let error: Color = SpectraAccent.danger.opacity(0.10)

    /// Info-tinted background for first-run / setup panels.
    /// Aurora indigo glow at 10% — matches `SpectraAccent.primaryGlow` family.
    static let info: Color = SpectraAccent.primary.opacity(0.10)
}

enum SpectraStroke {
    /// 1pt hairline for grouping containers.
    /// Aurora Glass `--glass-border` = rgba(255,255,255,0.08).
    static let hairline: Color = Color.white.opacity(0.08)

    /// 1pt subtle outline for inputs (text editor border).
    /// Slightly softer than hairline so input chrome doesn't shout over text.
    static let input: Color = Color.white.opacity(0.06)

    /// 1pt focused outline — picks up the accent glow.
    /// Use on `.focused()` modifiers.
    static let focused: Color = SpectraAccent.primary.opacity(0.45)
}

// MARK: - Spacing scale (8pt rhythm, snapped to multiples)
//
// Aurora Glass keeps the Calm Precision 8pt grid verbatim.

enum SpectraSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
    static let xl: CGFloat = 14
    static let xxl: CGFloat = 18
}

// MARK: - Corner radii
//
// Aurora Glass standardizes 12px for containers, 10px for inputs, 8px for
// nav items, 6px for inline tags. macOS popover surfaces are smaller than
// web cards, so we run one notch tighter (card=6, panel=10) — preserves the
// glass-radii rhythm without bloating compact UI.

enum SpectraRadius {
    static let card: CGFloat = 6
    static let panel: CGFloat = 10
}
