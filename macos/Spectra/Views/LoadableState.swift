// LoadableState.swift
//
// Generic async-state model: every fetch / poll / long-running task in the UI
// must move through one of these states, never a silent zero.
//
// Calm Precision principle 10 (Content Resilience + Error Strategy): empty,
// loading, and error states each need an explicit render path with a useful
// next action. This enum forces the call site to declare which it is.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import SwiftUI

/// Recovery action a user-facing error can suggest. Keeps copy in one place
/// instead of leaking raw `error.localizedDescription` into the UI.
public struct RecoveryError: Equatable, Sendable {
    /// Short, plain-language one-line summary. ("Anthropic refused the request.")
    public let title: String
    /// What to do next, one short sentence. ("Check the API key in Settings.")
    public let suggestion: String
    /// Optional label for an inline recovery button. nil → no button.
    public let actionLabel: String?

    public init(title: String, suggestion: String, actionLabel: String? = nil) {
        self.title = title
        self.suggestion = suggestion
        self.actionLabel = actionLabel
    }

    /// Map an arbitrary Swift error into a user-readable recovery shape.
    ///
    /// Heuristic: the raw `localizedDescription` becomes the suggestion; the
    /// title is the high-level category. We never echo the raw error verbatim
    /// in the title — that's where jargon usually lives.
    public static func from(_ error: Error, defaultTitle: String) -> RecoveryError {
        let raw = error.localizedDescription
        // Trim trailing periods so we control the punctuation.
        let cleaned = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return RecoveryError(
            title: defaultTitle,
            suggestion: cleaned.isEmpty ? "Try again in a moment." : cleaned + ".",
            actionLabel: nil
        )
    }
}

/// Discrete states a piece of UI can be in while talking to an async source.
enum LoadableState<Value> {
    case idle
    case loading
    case empty(message: String, actionLabel: String?)
    case error(RecoveryError)
    case loaded(Value)

    var isLoading: Bool {
        if case .loading = self { return true } else { return false }
    }
}
