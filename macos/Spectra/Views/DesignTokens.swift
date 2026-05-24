// DesignTokens.swift
//
// Centralized typography and color tokens for Spectra's macOS UI.
//
// Why: Calm Precision principle 3 (three-line hierarchy) and HIG accessibility
// require Dynamic-Type-aware text styles, not hardcoded point sizes. Color
// usage routes through semantic system colors so high-contrast mode + dark
// mode + light mode all "just work."
//
// Consume these throughout the Views/ layer instead of inline `.font(.system(size: 11))`
// or `Color.gray.opacity(0.08)`.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

// MARK: - Typography tokens (Dynamic-Type-aware)
//
// macOS body default = 13pt SF Pro. These map to SwiftUI's semantic font roles
// so they scale with the user's accessibility text-size preference.

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

// MARK: - Semantic surface tokens
//
// Map to system materials/colors so they adapt to light/dark/high-contrast.
// Never hardcode `Color.gray.opacity(0.08)` directly in a view — use these.

enum SpectraSurface {
    /// Subtle background for grouped content (recents list, selected-repo card).
    static let subtle: Color = Color(nsColor: .controlBackgroundColor).opacity(0.6)

    /// Slightly stronger background for emphasized regions (banner, callout).
    static let raised: Color = Color(nsColor: .controlBackgroundColor)

    /// Warning-tinted background for "needs attention" cards (helper offline).
    static let warning: Color = Color.orange.opacity(0.10)

    /// Error-tinted background for error toasts.
    static let error: Color = Color.red.opacity(0.10)

    /// Info-tinted background for first-run / setup panels.
    static let info: Color = Color.accentColor.opacity(0.10)
}

enum SpectraStroke {
    /// 1pt hairline for grouping containers. Separator color so it adapts.
    static let hairline: Color = Color(nsColor: .separatorColor)

    /// 1pt subtle outline for inputs (text editor border).
    static let input: Color = Color(nsColor: .separatorColor).opacity(0.7)
}

// MARK: - Spacing scale (8pt rhythm, snapped to multiples)

enum SpectraSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
    static let xl: CGFloat = 14
    static let xxl: CGFloat = 18
}

// MARK: - Corner radii

enum SpectraRadius {
    static let card: CGFloat = 6
    static let panel: CGFloat = 8
}
