// ActionButtonStyle.swift
//
// Shared button-state visuals. Honors user's standing rule:
// every action button must have distinct enabled (prominent) vs disabled
// (muted) visuals so the button's weight signals actionability before the
// user clicks.
//
// Two styles:
// - SpectraProminentButtonStyle: high-emphasis primary action (Save, Start,
//   Run walkthrough, Open System Settings). Filled when enabled; faded outline
//   when disabled.
// - SpectraStandardButtonStyle: lower-emphasis action (Stop, Reveal, Remove,
//   Check Again). Bordered when enabled; ghosted when disabled.
//
// Both styles read the SwiftUI environment's `isEnabled` so consumers just
// call `.disabled(condition)` as usual — no extra wiring needed.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

/// Prominent action — Save, Start, Run walkthrough, Open System Settings.
///
/// Enabled: filled accent background, white label.
/// Disabled: hollow outline, dimmed label, no fill. Signals "not yet" without
/// looking broken.
struct SpectraProminentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var size: ControlSize = .regular

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(size == .small ? SpectraText.metadata : SpectraText.bodyEmphasized)
            .padding(.horizontal, size == .small ? 8 : 12)
            .padding(.vertical, size == .small ? 4 : 6)
            .background(
                RoundedRectangle(cornerRadius: SpectraRadius.card)
                    .fill(isEnabled ? Color.accentColor : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: SpectraRadius.card)
                    .strokeBorder(
                        isEnabled ? Color.clear : SpectraStroke.input,
                        lineWidth: 1
                    )
            )
            .foregroundStyle(isEnabled ? Color.white : Color.secondary)
            .opacity(configuration.isPressed ? 0.75 : 1.0)
            .contentShape(Rectangle())
            .animation(.easeOut(duration: 0.12), value: isEnabled)
    }
}

/// Standard action — Stop, Reveal, Remove, Browse, Check Again, Done.
///
/// Enabled: bordered with subtle fill.
/// Disabled: same border but dimmed label + no fill.
struct SpectraStandardButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var size: ControlSize = .regular

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(size == .small ? SpectraText.metadata : SpectraText.body)
            .padding(.horizontal, size == .small ? 8 : 10)
            .padding(.vertical, size == .small ? 4 : 5)
            .background(
                RoundedRectangle(cornerRadius: SpectraRadius.card)
                    .fill(isEnabled ? SpectraSurface.subtle : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: SpectraRadius.card)
                    .strokeBorder(
                        isEnabled ? SpectraStroke.input : SpectraStroke.input.opacity(0.4),
                        lineWidth: 1
                    )
            )
            .foregroundStyle(isEnabled ? Color.primary : Color.secondary)
            .opacity(configuration.isPressed ? 0.75 : 1.0)
            .contentShape(Rectangle())
            .animation(.easeOut(duration: 0.12), value: isEnabled)
    }
}

// MARK: - View extension helpers

extension View {
    /// Apply Spectra's prominent action style.
    func spectraProminent(size: ControlSize = .regular) -> some View {
        self.buttonStyle(SpectraProminentButtonStyle(size: size))
    }

    /// Apply Spectra's standard action style.
    func spectraStandard(size: ControlSize = .regular) -> some View {
        self.buttonStyle(SpectraStandardButtonStyle(size: size))
    }
}
