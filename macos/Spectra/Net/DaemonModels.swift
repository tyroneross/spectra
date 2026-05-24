// DaemonModels.swift
//
// Codable structs mirroring the JSON shape returned by spectra MCP tools.
// Only fields the app actually consumes are decoded — extra fields are
// ignored by Swift's JSONDecoder default, so the daemon can evolve.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

public struct ConnectResult: Codable, Sendable {
    public let sessionId: String
    public let platform: String
    public let elementCount: Int?
    public let launched: LaunchedInfo?

    public struct LaunchedInfo: Codable, Sendable {
        public let kind: String
        public let pid: Int?
        public let url: String?
        public let appName: String?
    }
}

public struct SessionListItem: Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let platform: String
    public let steps: Int
    public let createdAt: String
}

public struct SessionListResult: Codable, Sendable {
    public let sessions: [SessionListItem]
}

public struct CaptureRecordingStart: Codable, Sendable {
    public let recordingId: String
    public let path: String
    public let startedAt: Double?
}

public struct CaptureRecordingStop: Codable, Sendable {
    public let path: String
    public let durationMs: Double?
    public let sizeBytes: Int?
    public let codec: String?
    public let fps: Int?
    public let droppedFrames: Int?
    public let alreadyStopped: Bool?
}

public struct ToolErrorPayload: Codable, Sendable {
    public let error: String
    public let tool: String?
    public let hint: String?
}
