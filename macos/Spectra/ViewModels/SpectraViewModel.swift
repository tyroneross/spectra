// SpectraViewModel.swift
//
// @Observable view model that owns the daemon client + session state.
// MenuBarExtra view + popover view are render-only consumers of this.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation
import Observation
import AppKit

@MainActor
@Observable
public final class SpectraViewModel {
    // ─── Connection state ────────────────────────────────────
    public enum DaemonStatus: Equatable {
        case unknown
        case unreachable(String)
        case ready(apiVersion: Int, daemonVersion: String)
        case versionSkew(found: Int, expected: Int)
    }
    public private(set) var daemonStatus: DaemonStatus = .unknown

    // ─── User-facing state ───────────────────────────────────
    public var selectedRepoPath: String?
    public var selectedRepoDisplayName: String?
    public var instructionText: String = ""
    public var recents: [RecentRepo] = []
    public var sessions: [SessionListItem] = []
    public var activeSessionId: String?
    public var isRecording: Bool = false
    public var lastErrorMessage: String?
    /// Recovery-shaped representation of the latest error. UI prefers this
    /// over `lastErrorMessage` (which retains raw text for legacy callers).
    public var recoveryError: RecoveryError?
    public var showAccessibilityPanel: Bool = false
    public var showSettings: Bool = false
    /// Mirrors KeychainStore presence so UI can enable / disable walkthrough
    /// without triggering a biometric prompt every time the popover renders.
    public var apiKeyPresent: Bool = false
    /// Last walkthrough outcome surfaced in the UI (token tally + result).
    public var lastWalkthroughOutcomeText: String?
    /// Set while a walkthrough is in flight.
    public private(set) var walkthroughRunning: Bool = false

    // ─── Status text for popover header ──────────────────────
    public var headerStatus: String {
        switch daemonStatus {
        case .unknown: return "Idle"
        case .unreachable(let reason): return "Daemon unreachable — \(reason)"
        case .versionSkew(let found, let expected):
            return "API \(found) — app expects \(expected) — please update Spectra"
        case .ready:
            if isRecording { return "Recording" }
            if activeSessionId != nil { return "Session active" }
            return "Idle"
        }
    }

    public var canStart: Bool {
        guard case .ready = daemonStatus else { return false }
        return selectedRepoPath != nil && activeSessionId == nil
    }

    public var canStop: Bool {
        activeSessionId != nil
    }

    public var canSave: Bool {
        activeSessionId != nil
    }

    public var canRunWalkthrough: Bool {
        guard case .ready = daemonStatus else { return false }
        return apiKeyPresent
            && !walkthroughRunning
            && activeSessionId != nil
            && !instructionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // ─── Dependencies ────────────────────────────────────────
    private let client: DaemonClient
    private let recentsStore: RecentsStore
    private var pollTask: Task<Void, Never>?

    public init(
        client: DaemonClient = DaemonClient(),
        recentsStore: RecentsStore = .shared
    ) {
        self.client = client
        self.recentsStore = recentsStore
        self.recents = recentsStore.list()
        self.apiKeyPresent = KeychainStore.shared.hasApiKey()
    }

    // ─── Lifecycle ───────────────────────────────────────────

    public func onPopoverShow() {
        Task { await self.checkDaemon() }
        startPolling()
    }

    public func onPopoverHide() {
        stopPolling()
    }

    public func checkDaemon() async {
        do {
            let info = try await client.probeVersion(timeout: 0.5)
            if info.apiVersion == DaemonClient.expectedApiVersion {
                self.daemonStatus = .ready(apiVersion: info.apiVersion, daemonVersion: info.daemonVersion)
            } else {
                self.daemonStatus = .versionSkew(found: info.apiVersion, expected: DaemonClient.expectedApiVersion)
            }
        } catch DaemonError.daemonUnreachable(let why) {
            self.daemonStatus = .unreachable(why)
        } catch {
            self.daemonStatus = .unreachable(error.localizedDescription)
        }
    }

    /// Returns true if the LaunchAgent plist exists on disk.
    public var daemonInstalled: Bool {
        (try? LaunchAgentManager()) != nil &&
        (try? LaunchAgentManager().isInstalled()) ?? false
    }

    /// Best-effort: install + bootstrap the LaunchAgent, then re-probe.
    public func installDaemon() async {
        lastErrorMessage = nil
        recoveryError = nil
        do {
            let mgr = try LaunchAgentManager()
            try mgr.install()
            try mgr.bootstrap()
            // Give launchd a beat to start the process.
            try? await Task.sleep(nanoseconds: 700_000_000)
            await checkDaemon()
        } catch {
            let recovery = RecoveryError.from(error, defaultTitle: SpectraCopy.errorInstallTitle)
            recoveryError = recovery
            lastErrorMessage = "\(recovery.title): \(recovery.suggestion)"
        }
    }

    private func startPolling() {
        stopPolling()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1Hz
                guard let self else { return }
                await self.refreshSessions()
            }
        }
    }

    private func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    public func refreshSessions() async {
        guard case .ready = daemonStatus else { return }
        do {
            let data = try await client.callTool(name: "spectra_session", arguments: ["action": "list"])
            let result = try JSONDecoder().decode(SessionListResult.self, from: data)
            self.sessions = result.sessions
        } catch {
            // Polling failures shouldn't spam the UI; only set if not already set.
            if recoveryError == nil {
                let recovery = RecoveryError.from(error, defaultTitle: SpectraCopy.errorPollTitle)
                recoveryError = recovery
                if lastErrorMessage == nil {
                    lastErrorMessage = "\(recovery.title): \(recovery.suggestion)"
                }
            }
        }
    }

    // ─── User actions ────────────────────────────────────────

    public func pickRepo(path: String) {
        let url = URL(fileURLWithPath: path)
        self.selectedRepoPath = path
        self.selectedRepoDisplayName = url.lastPathComponent
        recentsStore.remember(path: path)
        self.recents = recentsStore.list()
    }

    public func showBrowseDialog() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.title = "Choose a repository"
        panel.prompt = "Select"
        if panel.runModal() == .OK, let url = panel.url {
            pickRepo(path: url.path)
        }
    }

    public func startSession() async {
        guard let repoPath = selectedRepoPath else { return }
        lastErrorMessage = nil
        recoveryError = nil
        do {
            let args: [String: Any] = [
                "target": "auto",
                "repoPath": repoPath,
                "record": true,
            ]
            let data = try await client.callTool(name: "spectra_connect", arguments: args)
            let result = try JSONDecoder().decode(ConnectResult.self, from: data)
            self.activeSessionId = result.sessionId
            self.isRecording = (result.launched != nil) // optimistic; refined by poll
        } catch {
            let recovery = RecoveryError.from(error, defaultTitle: SpectraCopy.errorSessionTitle)
            recoveryError = recovery
            lastErrorMessage = "\(recovery.title): \(recovery.suggestion)"
        }
    }

    public func stopSession() async {
        guard let sid = activeSessionId else { return }
        lastErrorMessage = nil
        recoveryError = nil
        // Best-effort stop recording first
        _ = try? await client.callTool(name: "spectra_capture", arguments: [
            "sessionId": sid,
            "type": "stop_recording",
        ])
        // Then close session
        do {
            _ = try await client.callTool(name: "spectra_session", arguments: [
                "action": "close",
                "sessionId": sid,
            ])
            self.activeSessionId = nil
            self.isRecording = false
        } catch {
            let recovery = RecoveryError.from(error, defaultTitle: SpectraCopy.errorStopTitle)
            recoveryError = recovery
            lastErrorMessage = "\(recovery.title): \(recovery.suggestion)"
        }
    }

    public func revealSession() {
        guard let sid = activeSessionId ?? sessions.first?.id else { return }
        guard let repoPath = selectedRepoPath else { return }
        let path = (repoPath as NSString).appendingPathComponent(".spectra/sessions/\(sid)")
        if FileManager.default.fileExists(atPath: path) {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
        } else {
            NSWorkspace.shared.open(URL(fileURLWithPath: (repoPath as NSString).appendingPathComponent(".spectra")))
        }
    }

    public func clearError() {
        lastErrorMessage = nil
        recoveryError = nil
    }

    // ─── Walkthrough (C5-client) ─────────────────────────────

    public func runWalkthrough() async {
        guard canRunWalkthrough, let sid = activeSessionId else { return }
        let instruction = instructionText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !instruction.isEmpty else { return }
        lastErrorMessage = nil
        recoveryError = nil
        lastWalkthroughOutcomeText = nil
        walkthroughRunning = true
        defer { walkthroughRunning = false }
        let planner = WalkthroughPlanner(daemon: client)
        do {
            let outcome = try await planner.run(sessionId: sid, instruction: instruction)
            var summary = "Walkthrough \(outcome.success ? "completed" : "stopped") — \(outcome.stepsExecuted) steps over \(outcome.turns) turns. Used \(outcome.totalInputTokens) input + \(outcome.totalOutputTokens) output tokens."
            if let done = outcome.done { summary += " " + done }
            if let err = outcome.error { summary += " — \(err)" }
            lastWalkthroughOutcomeText = summary
        } catch {
            let recovery = RecoveryError.from(error, defaultTitle: SpectraCopy.errorWalkthroughTitle)
            recoveryError = recovery
            lastErrorMessage = "\(recovery.title): \(recovery.suggestion)"
        }
    }
}
