// Copy.swift
//
// Centralized user-facing strings. The rule: nothing visible in the UI should
// require knowing about background processes, RPC protocols, or system APIs.
// The Anthropic key is "your API key." The launchd process is "the helper" or
// "Spectra's background service." Accessibility permission is "permission to
// read other apps' content."
//
// Internal Swift identifiers (DaemonClient, daemonStatus, etc.) stay — those
// are code symbols, not user copy. This file is just for what the user
// SEES.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

enum SpectraCopy {

    // MARK: - Helper / background-service status

    /// Visible name of the background process (formerly "daemon").
    static let helperName = "Spectra's background service"

    /// Short form used in compact status pills.
    static let helperShort = "Background service"

    /// Header banner when the helper is not running.
    static let helperOfflineTitle = "Background service isn't running"

    /// Body line under the offline banner.
    static let helperOfflineBody = "Spectra needs its helper to capture screens and run walkthroughs. Install it once and it starts on every login."

    /// CTA button label that installs and starts the helper.
    static let helperInstallButton = "Install background service"

    /// Status-pill text when the helper is reachable.
    static let helperReadyShort = "Ready"

    /// Status-pill text when the helper is unreachable.
    static let helperOfflineShort = "Offline"

    /// Status-pill text when the helper reports a version mismatch.
    static let helperUpdateShort = "Update needed"

    /// Status-pill text while we haven't probed yet.
    static let helperCheckingShort = "Checking…"

    /// Status line shown in the popover footer / header area.
    static func helperStatusLine(_ status: SpectraViewModel.DaemonStatus, isRecording: Bool, hasActiveSession: Bool) -> String {
        switch status {
        case .unknown:
            return "Checking background service…"
        case .unreachable:
            return "Background service is offline."
        case .versionSkew(let found, let expected):
            return "Background service needs an update (running v\(found), this app expects v\(expected))."
        case .ready:
            if isRecording { return "Recording in progress." }
            if hasActiveSession { return "Session active." }
            return "Ready."
        }
    }

    // MARK: - Accessibility-permission panel

    static let accessibilityPanelTitle = "One last permission"
    static let accessibilityPanelBody = "To capture and walk through other apps, Spectra needs permission to read their content. macOS asks once, and you'll find Spectra under System Settings → Privacy & Security → Accessibility."
    static let accessibilityOpenButton = "Open System Settings"
    static let accessibilityCheckButton = "Check again"
    static let accessibilitySkipButton = "Skip for now"
    static let accessibilityGrantedLine = "Permission granted. You can capture other apps now."

    // MARK: - Screen Recording permission panel

    static let screenRecordingPanelTitle = "Enable Screen Recording"
    static let screenRecordingPanelBody = "To record videos and capture screens, Spectra needs Screen Recording permission. macOS asks once — allow it here, or find Spectra under System Settings → Privacy & Security → Screen Recording."
    static let screenRecordingAllowButton = "Allow Screen Recording"
    static let screenRecordingOpenButton = "Open System Settings"
    static let screenRecordingCheckButton = "Check again"
    static let screenRecordingSkipButton = "Skip for now"
    static let screenRecordingGrantedLine = "Screen Recording enabled. You can record now."

    // MARK: - Settings (API key)

    static let settingsKeyTitle = "Anthropic API key"
    static let settingsKeyHelp = "Required for walkthroughs. Stored locally in your Keychain. The helper never sees it."
    static let settingsKeyPlaceholder = "sk-ant-…"
    static let settingsSaveButton = "Save key"
    static let settingsRemoveButton = "Remove key"
    static let settingsDoneButton = "Done"
    static let settingsSheetTitle = "Settings"

    static func keyStoredLine(level: KeychainSecurityLevel) -> String {
        switch level {
        case .biometric: return "Key stored — protected by Touch ID."
        case .passcode:  return "Key stored — protected by your Mac passcode."
        case .standard:  return "Key stored — standard protection (unsigned build)."
        case .unknown:   return "Key stored."
        }
    }

    static let keyNotStoredLine = "No key stored yet."
    static let keyMissingHint = "Add an Anthropic API key in Settings to enable walkthroughs."

    // MARK: - Repository picker

    static let repoSectionTitle = "Project folder"
    static let repoBrowseButton = "Choose a folder…"
    static let repoEmptyMessage = "Choose a project folder to start capturing."
    static let repoRecentsTitle = "Recent"

    // MARK: - Walkthrough

    static let walkthroughFieldTitle = "What should Spectra walk through?"
    static let walkthroughPlaceholder = "Describe the flow in plain language. For example: \"Open the home page, scroll to the camp list, click the first card.\""
    static let walkthroughRunButton = "Run walkthrough"
    static let walkthroughRunningLabel = "Running…"

    // MARK: - Session actions

    static let startButton = "Start capture"
    static let stopButton = "Stop"
    static let revealButton = "Open in Finder"
    static let sessionsHeader = "Recent sessions"
    static let sessionsEmptyHint = "Sessions will appear here once you start a capture."

    // MARK: - Recovery error titles

    static let errorWalkthroughTitle = "Walkthrough couldn't finish"
    static let errorSessionTitle = "Couldn't start the session"
    static let errorStopTitle = "Couldn't stop the session"
    static let errorPollTitle = "Lost contact with the background service"
    static let errorKeySaveTitle = "Couldn't save your key"
    static let errorKeyRemoveTitle = "Couldn't remove your key"
    static let errorInstallTitle = "Couldn't install the background service"
    static let errorAnthropicTitle = "Anthropic refused the request"

    // MARK: - Generic actions

    static let dismissLabel = "Dismiss"
    static let quitLabel = "Quit Spectra"
    static let settingsLabel = "Settings"
    static let settingsHint = "Open Spectra settings"
    static let quitHint = "Quit the Spectra menu-bar app"
}
