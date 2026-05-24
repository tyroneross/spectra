// AnthropicClient.swift
//
// Standalone-app fallback path. Host-routed Spectra workflows do not need this
// client; the host agent supplies planning and Spectra executes MCP tools. This
// client remains for Spectra.app when no host agent is present.
//
// Hand-rolled (no SPM Anthropic SDK) URLSession client for the Messages API.
// Used by WalkthroughPlanner to ask Claude for a single action plan per turn.
//
// Build-from-scratch: hand-coded `/v1/messages` POST; non-streaming. The
// walkthrough planner wants the full JSON before executing any step, so SSE
// would add complexity without measurable benefit. Token usage comes from the
// response body's top-level `usage` field per Anthropic's documented schema:
// https://docs.anthropic.com/en/api/messages
//
// The API key NEVER touches the daemon. This client reads it from
// `KeychainStore` (biometric-protected) and goes direct to api.anthropic.com.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

// ─── Errors ──────────────────────────────────────────────────

public enum AnthropicError: Error, LocalizedError, Equatable {
    case missingApiKey
    case network(String)
    case httpStatus(code: Int, message: String)
    case malformedResponse(String)
    case overloaded
    case rateLimited(retryAfter: Double?)

    public var errorDescription: String? {
        switch self {
        case .missingApiKey: return "No Anthropic API key in Keychain. Open Settings to add one."
        case .network(let m): return "Network error: \(m)"
        case .httpStatus(let code, let m): return "Anthropic API error \(code): \(m)"
        case .malformedResponse(let m): return "Malformed Anthropic response: \(m)"
        case .overloaded: return "Anthropic API overloaded (529); retry later."
        case .rateLimited(let s):
            if let s { return "Rate limited; retry after \(s)s." }
            return "Rate limited."
        }
    }
}

// ─── Request/Response models ─────────────────────────────────

/// Anthropic Messages API request — minimal shape we need.
public struct AnthropicRequest: Codable, Sendable {
    public let model: String
    public let max_tokens: Int
    public let system: String?
    public let messages: [Message]
    /// Optional temperature override; default 0 for deterministic action plans.
    public let temperature: Double?

    public struct Message: Codable, Sendable {
        public let role: String      // "user" | "assistant"
        public let content: Content

        public enum Content: Codable, Sendable {
            case text(String)
            case blocks([Block])

            public func encode(to encoder: Encoder) throws {
                switch self {
                case .text(let value):
                    var container = encoder.singleValueContainer()
                    try container.encode(value)
                case .blocks(let blocks):
                    var container = encoder.singleValueContainer()
                    try container.encode(blocks)
                }
            }

            public init(from decoder: Decoder) throws {
                let container = try decoder.singleValueContainer()
                if let text = try? container.decode(String.self) {
                    self = .text(text)
                } else {
                    self = .blocks(try container.decode([Block].self))
                }
            }
        }

        public struct Block: Codable, Sendable {
            public let type: String
            public let text: String?
            public let source: ImageSource?

            public static func text(_ value: String) -> Block {
                Block(type: "text", text: value, source: nil)
            }

            public static func pngImage(base64: String) -> Block {
                Block(type: "image", text: nil, source: ImageSource(data: base64))
            }
        }

        public struct ImageSource: Codable, Sendable {
            public let type: String
            public let media_type: String
            public let data: String

            public init(data: String) {
                self.type = "base64"
                self.media_type = "image/png"
                self.data = data
            }
        }
    }

    public init(model: String, maxTokens: Int, system: String?, messages: [Message], temperature: Double? = 0) {
        self.model = model
        self.max_tokens = maxTokens
        self.system = system
        self.messages = messages
        self.temperature = temperature
    }
}

/// Anthropic Messages API response — minimal subset we consume.
public struct AnthropicResponse: Codable, Sendable {
    public let id: String
    public let model: String
    public let role: String
    public let stop_reason: String?
    public let content: [Block]
    public let usage: Usage

    public struct Block: Codable, Sendable {
        public let type: String
        public let text: String?
    }

    public struct Usage: Codable, Sendable {
        public let input_tokens: Int
        public let output_tokens: Int
    }

    /// Concatenated text from all "text" blocks in `content`.
    public var firstText: String {
        content.compactMap { $0.type == "text" ? $0.text : nil }.joined()
    }
}

// ─── Client ──────────────────────────────────────────────────

public actor AnthropicClient {
    public static let defaultModel = "claude-haiku-4-5"
    public static let defaultMaxTokens = 1024
    public static let apiURL = URL(string: "https://api.anthropic.com/v1/messages")!
    public static let apiVersion = "2023-06-01"

    private let session: URLSession
    private let keychain: KeychainStore
    private let model: String
    private let maxTokens: Int

    public init(
        keychain: KeychainStore = .shared,
        model: String = AnthropicClient.defaultModel,
        maxTokens: Int = AnthropicClient.defaultMaxTokens,
        session: URLSession? = nil
    ) {
        self.keychain = keychain
        self.model = model
        self.maxTokens = maxTokens
        if let custom = session {
            self.session = custom
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 60
            config.timeoutIntervalForResource = 120
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
    }

    /// One non-streaming Messages call. Returns the parsed response on 2xx;
    /// throws an `AnthropicError` otherwise. Caller is responsible for parsing
    /// the response's `firstText` (typically JSON the planner asked Claude
    /// to emit).
    public func messages(system: String?, user: String, screenshotBase64: String? = nil, model overrideModel: String? = nil) async throws -> AnthropicResponse {
        let apiKey: String
        do {
            apiKey = try keychain.loadApiKey()
        } catch {
            throw AnthropicError.missingApiKey
        }

        let content: AnthropicRequest.Message.Content
        if let screenshotBase64, !screenshotBase64.isEmpty {
            content = .blocks([
                .text(user),
                .pngImage(base64: screenshotBase64),
            ])
        } else {
            content = .text(user)
        }

        let req = AnthropicRequest(
            model: overrideModel ?? model,
            maxTokens: maxTokens,
            system: system,
            messages: [.init(role: "user", content: content)],
            temperature: 0
        )
        let body: Data
        do {
            body = try JSONEncoder().encode(req)
        } catch {
            throw AnthropicError.malformedResponse("encode: \(error.localizedDescription)")
        }

        var urlReq = URLRequest(url: Self.apiURL)
        urlReq.httpMethod = "POST"
        urlReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlReq.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        urlReq.setValue(Self.apiVersion, forHTTPHeaderField: "anthropic-version")
        urlReq.httpBody = body
        urlReq.timeoutInterval = 60

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: urlReq)
        } catch let urlErr as URLError {
            throw AnthropicError.network(urlErr.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw AnthropicError.malformedResponse("not HTTPURLResponse")
        }

        if http.statusCode == 401 || http.statusCode == 403 {
            throw AnthropicError.httpStatus(code: http.statusCode, message: "API key rejected")
        }
        if http.statusCode == 429 {
            let retry = http.value(forHTTPHeaderField: "retry-after").flatMap(Double.init)
            throw AnthropicError.rateLimited(retryAfter: retry)
        }
        if http.statusCode == 529 {
            throw AnthropicError.overloaded
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "<binary>"
            throw AnthropicError.httpStatus(code: http.statusCode, message: String(body.prefix(400)))
        }

        do {
            let decoder = JSONDecoder()
            return try decoder.decode(AnthropicResponse.self, from: data)
        } catch {
            let snippet = String(data: data, encoding: .utf8).map { String($0.prefix(400)) } ?? ""
            throw AnthropicError.malformedResponse("decode: \(error.localizedDescription); body: \(snippet)")
        }
    }
}
