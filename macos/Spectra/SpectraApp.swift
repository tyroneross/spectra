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
            // Red dot when recording; gray dot when idle; faded when daemon offline.
            Image(systemName: menuBarSymbolName)
                .accessibilityLabel("Spectra")
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
}
