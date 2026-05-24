// WalkthroughPlanner.swift
//
// Standalone-app fallback path. Host agents should drive walkthroughs by
// reading `spectra_snapshot`, planning in the host LLM, and executing through
// Spectra MCP tools. This planner is kept for Spectra.app sessions launched
// without a host agent.
//
// Drives the walkthrough loop:
//   1. snapshot (spectra_snapshot)
//   2. ask Claude for an action plan (AnthropicClient + PromptBuilder)
//   3. execute via spectra_llm_step on the daemon
//   4. repeat until done / error / step cap
//
// The daemon never sees the API key; it only executes pre-resolved actions.
// Token usage is summed locally and persisted to
// <repo>/.spectra/sessions/<id>/llm-usage.json via a `record_llm_usage` call
// to `spectra_session` (best-effort — the daemon-side tool may not be present
// in older daemons, in which case we skip silently).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

// ─── Public result shape ─────────────────────────────────────

public struct WalkthroughOutcome: Sendable, Equatable {
    public let stepsExecuted: Int
    public let success: Bool
    public let done: String?
    public let error: String?
    public let totalInputTokens: Int
    public let totalOutputTokens: Int
    public let turns: Int

    public init(stepsExecuted: Int, success: Bool, done: String?, error: String?, totalInputTokens: Int, totalOutputTokens: Int, turns: Int) {
        self.stepsExecuted = stepsExecuted
        self.success = success
        self.done = done
        self.error = error
        self.totalInputTokens = totalInputTokens
        self.totalOutputTokens = totalOutputTokens
        self.turns = turns
    }
}

enum WalkthroughSuccessPolicy {
    static func evaluate(done: String?, predicateMatched: Bool, lastError: String?) -> Bool {
        guard lastError == nil else { return false }
        return done != nil || predicateMatched
    }

    static func shouldRetryStepFailure(policy: RetryPolicy, alreadyRetried: Bool) -> Bool {
        policy != .none && !alreadyRetried
    }
}

// ─── Planner ─────────────────────────────────────────────────

public actor WalkthroughPlanner {
    public static let defaultMaxTurns = 10

    private let daemon: DaemonClient
    private let anthropic: AnthropicClient
    private let config: WalkthroughConfig
    private let maxTurns: Int

    public init(
        daemon: DaemonClient = DaemonClient(),
        anthropic: AnthropicClient? = nil,
        config: WalkthroughConfig = .default,
        maxTurns: Int = WalkthroughPlanner.defaultMaxTurns
    ) {
        self.daemon = daemon
        self.anthropic = anthropic ?? AnthropicClient(model: config.model)
        self.config = config
        self.maxTurns = maxTurns
    }

    /// Run the planner against an existing session. The session must already
    /// be connected (spectra_connect with a repoPath).
    public func run(sessionId: String, instruction: String) async throws -> WalkthroughOutcome {
        let prompts = PromptBuilder(config: config)
        var history: [String] = []
        var totalIn = 0
        var totalOut = 0
        var stepsExecuted = 0
        var turns = 0
        var lastError: String? = nil
        var done: String? = nil
        var stepFailureRetryUsed = false

        for turn in 0..<maxTurns {
            turns = turn + 1

            let snapshotPayload: SnapshotToolResponse
            do {
                snapshotPayload = try await fetchSnapshot(sessionId: sessionId)
            } catch {
                lastError = "snapshot failed: \(error.localizedDescription)"
                break
            }

            // Ask Claude for the next plan.
            let user = prompts.userPrompt(instruction: instruction, snapshot: snapshotPayload.snapshot, history: history)
            let resp: AnthropicResponse
            do {
                resp = try await anthropic.messages(
                    system: prompts.systemPrompt(),
                    user: user,
                    screenshotBase64: snapshotPayload.screenshot
                )
            } catch let err as AnthropicError {
                // F3 retry policy: one retry on overload / rate-limit / network.
                if config.retry != .none && (err == .overloaded || isRetryable(err)) {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    do {
                        resp = try await anthropic.messages(
                            system: prompts.systemPrompt(),
                            user: user,
                            screenshotBase64: snapshotPayload.screenshot
                        )
                    } catch {
                        lastError = "LLM error (after retry): \(err.localizedDescription)"
                        break
                    }
                } else {
                    lastError = "LLM error: \(err.localizedDescription)"
                    break
                }
            }
            totalIn += resp.usage.input_tokens
            totalOut += resp.usage.output_tokens

            let plan: PlanResponse
            do {
                plan = try PlanParser.parse(resp.firstText)
            } catch {
                lastError = "plan parse failed: \(error.localizedDescription)"
                break
            }

            if let goalDone = plan.done, plan.actions.isEmpty {
                done = goalDone
                break
            }
            if let planError = plan.error, plan.actions.isEmpty {
                lastError = planError
                break
            }
            if plan.actions.isEmpty {
                lastError = "empty plan with no done/error"
                break
            }

            // Execute on the daemon.
            let stepResult = try await executePlan(sessionId: sessionId, actions: plan.actions)
            stepsExecuted += stepResult.stepsExecuted

            // Record history descriptions for the next turn.
            for (i, step) in plan.actions.enumerated() {
                let outcome = i < stepResult.results.count ? stepResult.results[i] : nil
                let ok = outcome?.success ?? false
                let intent = step.intent ?? "\(step.type) \(step.elementId)"
                history.append("\(intent) — \(ok ? "ok" : "failed: \(outcome?.error ?? "unknown")")")
            }

            if !stepResult.success {
                lastError = "step execution failed at index \(stepResult.stepsExecuted - 1)"
                if WalkthroughSuccessPolicy.shouldRetryStepFailure(policy: config.retry, alreadyRetried: stepFailureRetryUsed) {
                    stepFailureRetryUsed = true
                    lastError = nil
                    continue
                }
                break
            }
        }

        let outcome = WalkthroughOutcome(
            stepsExecuted: stepsExecuted,
            success: WalkthroughSuccessPolicy.evaluate(done: done, predicateMatched: false, lastError: lastError),
            done: done,
            error: lastError,
            totalInputTokens: totalIn,
            totalOutputTokens: totalOut,
            turns: turns
        )

        // Best-effort usage persistence.
        await persistUsage(sessionId: sessionId, outcome: outcome)

        return outcome
    }

    // ─── Helpers ─────────────────────────────────────────────

    private struct SnapshotToolResponse: Codable {
        let snapshot: String
        let screenshot: String?
    }

    private func fetchSnapshot(sessionId: String) async throws -> SnapshotToolResponse {
        var args: [String: Any] = ["sessionId": sessionId]
        if config.snapshot == .axPlusScreenshot {
            args["screenshot"] = true
        }
        let data = try await daemon.callTool(name: "spectra_snapshot", arguments: args)
        return try JSONDecoder().decode(SnapshotToolResponse.self, from: data)
    }

    /// Daemon-side LlmStepResult mirror (only the fields we read).
    private struct LlmStepResp: Codable {
        let stepsExecuted: Int
        let stepsTotal: Int
        let success: Bool
        let results: [Outcome]
        struct Outcome: Codable {
            let index: Int
            let intent: String?
            let success: Bool
            let error: String?
        }
    }

    private func executePlan(sessionId: String, actions: [ActionPlanStep]) async throws -> LlmStepResp {
        // Re-encode the actions as plain dictionaries since callTool takes [String:Any].
        let payload: [[String: Any]] = actions.map { step in
            var d: [String: Any] = [
                "type": step.type,
                "elementId": step.elementId,
            ]
            if let v = step.value { d["value"] = v }
            if let i = step.intent { d["intent"] = i }
            if let w = step.waitAfterMs { d["waitAfterMs"] = w }
            return d
        }
        let data = try await daemon.callTool(name: "spectra_llm_step", arguments: [
            "sessionId": sessionId,
            "actions": payload,
        ])
        return try JSONDecoder().decode(LlmStepResp.self, from: data)
    }

    private func persistUsage(sessionId: String, outcome: WalkthroughOutcome) async {
        let usage: [String: Any] = [
            "sessionId": sessionId,
            "totalInputTokens": outcome.totalInputTokens,
            "totalOutputTokens": outcome.totalOutputTokens,
            "turns": outcome.turns,
            "stepsExecuted": outcome.stepsExecuted,
            "model": config.model,
            "config": [
                "snapshot": config.snapshot.rawValue,
                "granularity": config.granularity.rawValue,
                "retry": config.retry.rawValue,
                "structure": config.structure.rawValue,
            ],
            "success": outcome.success,
            "ts": Date().timeIntervalSince1970,
        ]
        _ = try? await daemon.callTool(name: "spectra_session", arguments: [
            "action": "record_llm_usage",
            "sessionId": sessionId,
            "usage": usage,
        ])
        // Best-effort — daemon may not implement record_llm_usage; the
        // outcome is already returned to the caller. We swallow the error.
    }

    private func isRetryable(_ err: AnthropicError) -> Bool {
        switch err {
        case .overloaded, .rateLimited, .network: return true
        default: return false
        }
    }
}
