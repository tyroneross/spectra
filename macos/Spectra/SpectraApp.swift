// SpectraApp.swift
//
// App entry point. `MenuBarExtra` with `.window` style gives us a SwiftUI
// popover; the App owns the SpectraViewModel.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

@main
struct SpectraApp: App {
    @State private var viewModel = SpectraViewModel()

    var body: some Scene {
        MenuBarExtra {
            MenuBarPopover(vm: viewModel)
                .task {
                    await viewModel.checkDaemon()
                    viewModel.showAccessibilityPanel = AccessibilityPanel.shouldShow()
                }
        } label: {
            // The symbol communicates state: outlined viewfinder = ready,
            // outlined-with-slash = service offline, filled-record = recording.
            Image(systemName: menuBarSymbolName)
                .accessibilityLabel("Spectra")
                .accessibilityValue(menuBarA11yValue)
        }
        .menuBarExtraStyle(.window)
    }

    private var menuBarSymbolName: String {
        if viewModel.isRecording {
            return "record.circle.fill"
        }
        switch viewModel.daemonStatus {
        case .ready: return "viewfinder.circle"
        case .unreachable, .versionSkew: return "viewfinder.circle.slash"
        case .unknown: return "viewfinder.circle"
        }
    }

    /// Speakable description of the menu-bar icon's current state.
    private var menuBarA11yValue: String {
        if viewModel.isRecording { return "Recording" }
        switch viewModel.daemonStatus {
        case .ready: return "Ready"
        case .unreachable: return "Background service offline"
        case .versionSkew: return "Background service needs an update"
        case .unknown: return "Checking background service"
        }
    }
}
