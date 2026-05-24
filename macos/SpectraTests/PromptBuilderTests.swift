// PromptBuilderTests.swift
//
// Exercises the prompt assembly + JSON plan parser. No network. No keychain.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import XCTest
@testable import Spectra

final class PromptBuilderTests: XCTestCase {

    // ─── System prompt ───────────────────────────────────────

    func test_systemPrompt_terse_oneAction_isShort() {
        let pb = PromptBuilder(config: WalkthroughConfig(granularity: .oneAction, structure: .terse))
        let s = pb.systemPrompt()
        XCTAssertTrue(s.contains("one next action"))
        XCTAssertLessThan(s.count, 200)
    }

    func test_systemPrompt_full_includesExamplesAndToolList() {
        let pb = PromptBuilder(config: WalkthroughConfig(granularity: .oneAction, structure: .roleToolsThreeShot))
        let s = pb.systemPrompt()
        XCTAssertTrue(s.contains("click(elementId)"))
        XCTAssertTrue(s.contains("type(elementId, value)"))
        XCTAssertTrue(s.contains("Examples"))
        XCTAssertTrue(s.contains("Log in"))
    }

    func test_userPrompt_threading_includesHistory() {
        let pb = PromptBuilder()
        let p = pb.userPrompt(
            instruction: "find the settings page",
            snapshot: "<snapshot>",
            history: ["click home — ok", "click menu — failed"]
        )
        XCTAssertTrue(p.contains("Steps already taken"))
        XCTAssertTrue(p.contains("click home"))
        XCTAssertTrue(p.contains("click menu"))
        XCTAssertTrue(p.contains("<snapshot>"))
    }

    // ─── PlanParser ──────────────────────────────────────────

    func test_planParser_basicActions() throws {
        let raw = """
        {
          "actions": [
            {"type":"click","elementId":"e7","intent":"go to login"},
            {"type":"type","elementId":"f3","value":"alice","intent":"enter name"}
          ]
        }
        """
        let plan = try PlanParser.parse(raw)
        XCTAssertEqual(plan.actions.count, 2)
        XCTAssertEqual(plan.actions[0].type, "click")
        XCTAssertEqual(plan.actions[0].elementId, "e7")
        XCTAssertEqual(plan.actions[1].value, "alice")
        XCTAssertNil(plan.done)
        XCTAssertNil(plan.error)
    }

    func test_planParser_stripsMarkdownFences() throws {
        let raw = """
        ```json
        {"actions":[],"done":"goal achieved"}
        ```
        """
        let plan = try PlanParser.parse(raw)
        XCTAssertTrue(plan.actions.isEmpty)
        XCTAssertEqual(plan.done, "goal achieved")
    }

    func test_planParser_extractsTrailingProse() throws {
        // Even when the LLM prepends explanation, we should still find the JSON.
        let raw = """
        Sure, here is the plan:
        {"actions":[{"type":"click","elementId":"x1"}]}
        Let me know if anything else.
        """
        let plan = try PlanParser.parse(raw)
        XCTAssertEqual(plan.actions.count, 1)
        XCTAssertEqual(plan.actions[0].elementId, "x1")
    }

    func test_planParser_rejectsNonObject() {
        XCTAssertThrowsError(try PlanParser.parse("not json at all")) { err in
            XCTAssertTrue("\(err)".contains("no JSON object"))
        }
    }

    // ─── Walkthrough outcome policy ──────────────────────────

    func test_walkthroughSuccess_requiresDoneOrPredicateMatch() {
        XCTAssertFalse(WalkthroughSuccessPolicy.evaluate(done: nil, predicateMatched: false, lastError: nil))
        XCTAssertTrue(WalkthroughSuccessPolicy.evaluate(done: "goal achieved", predicateMatched: false, lastError: nil))
        XCTAssertTrue(WalkthroughSuccessPolicy.evaluate(done: nil, predicateMatched: true, lastError: nil))
        XCTAssertFalse(WalkthroughSuccessPolicy.evaluate(done: "goal achieved", predicateMatched: true, lastError: "step failed"))
    }

    func test_walkthroughRetryPolicy_allowsOnlyOneStepFailureRetry() {
        XCTAssertTrue(WalkthroughSuccessPolicy.shouldRetryStepFailure(policy: .oneRetryResnapshot, alreadyRetried: false))
        XCTAssertFalse(WalkthroughSuccessPolicy.shouldRetryStepFailure(policy: .oneRetryResnapshot, alreadyRetried: true))
        XCTAssertFalse(WalkthroughSuccessPolicy.shouldRetryStepFailure(policy: .none, alreadyRetried: false))
    }
}
