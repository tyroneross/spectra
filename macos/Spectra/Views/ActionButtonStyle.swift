// ActionButtonStyle.swift
//
// Shared button-state visuals. Honors user's standing rule:
// every action button must have distinct enabled (prominent) vs disabled
// (muted) visuals so the button's weight signals actionability before the
// user clicks.
//
// Visual register: Aurora Glass.
// Prominent enabled = solid indigo fill (Aurora `--accent` #818cf8) with a
// soft glow shadow (Aurora Glass §"Buttons" CTA spec, lightened from the
// Deep variant — "0 2px 8px rgba(99,102,241,0.25)").
// Prominent disabled = hollow outline using `--glass-border`, dim label.
// Standard enabled = `--surface` glass fill with `--glass-border`.
// Standard disabled = same border softened, no fill.
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
/// Enabled: indigo accent fill, white label, soft accent glow.
/// Disabled: hollow outline, dimmed label, no fill. Signals "not yet" without
/// looking broken.
struct SpectraProminentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var size: ControlSize = .regular

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(size == .small ? SpectraText.metadata : SpectraText.bodyEmphasized)
            .padding(.horizontal, size == .small ? 10 : 12)
            .padding(.vertical, size == .small ? 5 : 6)
            .frame(minHeight: size == .small ? 24 : 28) // align with standard buttons
            .background(
                RoundedRectangle(cornerRadius: SpectraRadius.card)
                    .fill(isEnabled
                        ? SpectraAccent.primary.opacity(configuration.isPressed ? 0.82 : 1.0)
                        : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: SpectraRadius.card)
                    .strokeBorder(
                        isEnabled ? Color.clear : SpectraStroke.hairline,
                        lineWidth: 1
                    )
            )
            // Accent CTA glow — kept tight on the compact menu-bar surface so it
            // signals "primary" without blooming. Disabled = no glow.
            .shadow(
                color: isEnabled ? SpectraAccent.primary.opacity(0.22) : Color.clear,
                radius: 5,
                x: 0,
                y: 1
            )
            .foregroundStyle(isEnabled ? Color.white : Color.secondary)
            .contentShape(Rectangle())
            .animation(.easeOut(duration: 0.12), value: isEnabled)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

/// Standard action — Stop, Reveal, Remove, Browse, Check Again, Done.
///
/// Enabled: bordered with subtle fill (Aurora Glass `--surface`).
/// Disabled: same border softened + dimmed label + no fill.
struct SpectraStandardButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var size: ControlSize = .regular

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(size == .small ? SpectraText.metadata : SpectraText.body)
            .padding(.horizontal, size == .small ? 10 : 12)
            .padding(.vertical, size == .small ? 5 : 6)
            .frame(minHeight: size == .small ? 24 : 28) // WCAG 2.5.8 desktop floor
            .background(
                RoundedRectangle(cornerRadius: SpectraRadius.card)
                    // Enabled: a control fill that reads as a button in BOTH
                    // light and dark. Pressed: deepen the fill for tactile
                    // confirmation. Disabled: no fill (outline only).
                    .fill(
                        isEnabled
                            ? (configuration.isPressed ? SpectraSurface.subtleHover : SpectraSurface.control)
                            : Color.clear
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: SpectraRadius.card)
                    .strokeBorder(
                        isEnabled ? SpectraStroke.hairline : SpectraStroke.hairline.opacity(0.45),
                        lineWidth: 1
                    )
            )
            .foregroundStyle(isEnabled ? Color.primary : Color.secondary)
            .contentShape(Rectangle())
            .animation(.easeOut(duration: 0.12), value: isEnabled)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
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
