// PromptBuilder.swift
//
// Assembles the walkthrough planner prompt. Each method is a DOE factor cell:
//
//   F1 snapshot type   — axOnly / domOnly / axPlusScreenshot
//   F2 granularity     — oneAction / threeToFive
//   F3 retry policy    — none / oneRetryResnapshot / oneRetryBroaden
//   F4 prompt structure — terse / roleToolsThreeShot
//   F5 model           — claude-haiku-4-5 / claude-sonnet-4-6 (passed to AnthropicClient)
//
// Default config (chosen as the most defensible starting cell before the C7.a
// DOE; the DOE rebalances the defaults from runs.jsonl evidence):
//   snapshot=axOnly, granularity=oneAction, retry=oneRetryResnapshot,
//   structure=roleToolsThreeShot, model=claude-haiku-4-5
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

// ─── DOE factor levels ───────────────────────────────────────

public enum SnapshotType: String, Codable, Sendable, CaseIterable {
    case axOnly
    case domOnly
    case axPlusScreenshot
}

public enum Granularity: String, Codable, Sendable, CaseIterable {
    case oneAction        // emit exactly one next step, return immediately
    case threeToFive      // emit a small contiguous plan
}

public enum RetryPolicy: String, Codable, Sendable, CaseIterable {
    case none
    case oneRetryResnapshot   // on failure, re-snapshot and call the LLM again
    case oneRetryBroaden      // on failure, broaden the element search heuristically
}

public enum PromptStructure: String, Codable, Sendable, CaseIterable {
    case terse                // single paragraph, no examples
    case roleToolsThreeShot   // role+tools description+3 worked examples
}

// ─── Config ──────────────────────────────────────────────────

public struct WalkthroughConfig: Codable, Sendable, Equatable {
    public var snapshot: SnapshotType
    public var granularity: Granularity
    public var retry: RetryPolicy
    public var structure: PromptStructure
    public var model: String

    public init(
        snapshot: SnapshotType = .axOnly,
        granularity: Granularity = .oneAction,
        retry: RetryPolicy = .oneRetryResnapshot,
        structure: PromptStructure = .roleToolsThreeShot,
        model: String = AnthropicClient.defaultModel
    ) {
        self.snapshot = snapshot
        self.granularity = granularity
        self.retry = retry
        self.structure = structure
        self.model = model
    }

    public static let `default` = WalkthroughConfig()
}

// ─── Prompt assembly ─────────────────────────────────────────

public struct PromptBuilder {
    public let config: WalkthroughConfig

    public init(config: WalkthroughConfig = .default) {
        self.config = config
    }

    /// Builds the system prompt (role + tools + optionally examples).
    public func systemPrompt() -> String {
        switch config.structure {
        case .terse:
            return Self.tersePrompt(granularity: config.granularity)
        case .roleToolsThreeShot:
            return Self.fullPrompt(granularity: config.granularity)
        }
    }

    /// Builds the user-turn payload from a serialized snapshot + the user's
    /// natural-language instruction + optionally prior step results.
    public func userPrompt(instruction: String, snapshot: String, history: [String] = []) -> String {
        var s = ""
        s += "# Goal\n\(instruction)\n\n"
        if !history.isEmpty {
            s += "# Steps already taken\n"
            for (i, h) in history.enumerated() {
                s += "\(i + 1). \(h)\n"
            }
            s += "\n"
        }
        s += "# Current UI snapshot\n"
        s += "```\n\(snapshot)\n```\n\n"
        s += Self.outputContract(granularity: config.granularity)
        return s
    }

    // ─── Static prompt fragments ─────────────────────────────

    private static func tersePrompt(granularity: Granularity) -> String {
        switch granularity {
        case .oneAction:
            return "You drive UIs. Given a snapshot and a goal, output exactly one next action as JSON."
        case .threeToFive:
            return "You drive UIs. Given a snapshot and a goal, output 3-5 next actions as a JSON array."
        }
    }

    private static func fullPrompt(granularity: Granularity) -> String {
        let countDirective = granularity == .oneAction
            ? "Emit exactly ONE next action."
            : "Emit a plan of 3 to 5 next actions in sequence."

        return """
        You are Spectra's walkthrough planner. You drive a UI by emitting a structured \
        action plan that an executor will run against a live application.

        # Available actions
        - click(elementId)           — click or tap a visible element
        - type(elementId, value)     — type text into an input
        - clear(elementId)           — clear an input
        - select(elementId, value)   — pick an option from a list/dropdown
        - scroll(elementId)          — scroll the element (or page if document)
        - hover(elementId)           — hover over an element
        - focus(elementId)           — give an element keyboard focus

        # How to plan
        - You receive an accessibility snapshot listing elements with stable ids.
        - Choose the action(s) that make the most concrete progress toward the user's goal.
        - Never invent element ids. Only use ids that appear in the snapshot.
        - \(countDirective)
        - If the goal is already satisfied, emit zero actions and explain in `done` block.
        - If no action makes progress (no relevant element on screen), emit zero actions \
          and explain in `error` block.

        # Examples
        Snapshot has `{"id":"e7","role":"button","label":"Log in"}`. Goal: "log in".
        Output:
        {"actions":[{"type":"click","elementId":"e7","intent":"open login form"}]}

        Snapshot has `{"id":"f3","role":"textfield","label":"Email"}` and \
        `{"id":"f4","role":"textfield","label":"Password"}`. Goal: \
        "sign in as alice@example.com / hunter2".
        Output:
        {"actions":[
          {"type":"type","elementId":"f3","value":"alice@example.com","intent":"enter email"},
          {"type":"type","elementId":"f4","value":"hunter2","intent":"enter password"}
        ]}

        Snapshot has no relevant elements for "checkout". Output:
        {"actions":[],"error":"No checkout-related elements visible. Try scrolling or navigating."}
        """
    }

    private static func outputContract(granularity: Granularity) -> String {
        let limit = granularity == .oneAction ? "exactly 1 element" : "between 3 and 5 elements"
        return """
        # Output format
        Respond with ONLY a JSON object (no prose, no markdown fences). Shape:
        {
          "actions": [ /* \(limit), each: {type, elementId, value?, intent?} */ ],
          "done"?:  "explanation if goal is satisfied",
          "error"?: "explanation if no progress is possible"
        }
        """
    }
}

// ─── Plan parsing ────────────────────────────────────────────

/// Mirrors `src/mcp/tools/llm-step.ts > ActionPlanStep`.
public struct ActionPlanStep: Codable, Sendable, Equatable {
    public let type: String      // "click" | "type" | "clear" | "select" | "scroll" | "hover" | "focus"
    public let elementId: String
    public let value: String?
    public let intent: String?
    public let waitAfterMs: Int?

    public init(type: String, elementId: String, value: String? = nil, intent: String? = nil, waitAfterMs: Int? = nil) {
        self.type = type
        self.elementId = elementId
        self.value = value
        self.intent = intent
        self.waitAfterMs = waitAfterMs
    }
}

public struct PlanResponse: Codable, Sendable, Equatable {
    public let actions: [ActionPlanStep]
    public let done: String?
    public let error: String?
}

/// Strips common LLM artifacts (fences, leading prose) and decodes JSON.
public enum PlanParser {
    public static func parse(_ raw: String) throws -> PlanResponse {
        let body = stripFences(raw).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let start = body.firstIndex(of: "{"), let end = body.lastIndex(of: "}") else {
            throw AnthropicError.malformedResponse("no JSON object in: \(raw.prefix(120))")
        }
        let jsonSlice = String(body[start...end])
        guard let data = jsonSlice.data(using: .utf8) else {
            throw AnthropicError.malformedResponse("non-utf8 JSON slice")
        }
        do {
            return try JSONDecoder().decode(PlanResponse.self, from: data)
        } catch {
            throw AnthropicError.malformedResponse("decode plan: \(error.localizedDescription); slice: \(jsonSlice.prefix(200))")
        }
    }

    private static func stripFences(_ s: String) -> String {
        var out = s
        if out.hasPrefix("```") {
            if let nl = out.firstIndex(of: "\n") {
                out = String(out[out.index(after: nl)...])
            }
        }
        if out.hasSuffix("```") {
            out = String(out.dropLast(3))
        }
        return out
    }
}
