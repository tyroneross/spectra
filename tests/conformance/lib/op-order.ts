// tests/conformance/lib/op-order.ts
//
// Single source of truth for the ORDER in which the conformance suite AND the
// corpus recorder iterate the 30 contract operations. This exists because the
// D1 defect (session-destroying ops running alphabetically-early, gutting the
// fixture sessions so ~14 session-dependent ops only ever hit the error path)
// bit BOTH arms of the oracle: the live conformance suite AND the recorded
// golden corpus. Fixing it in only one place (conformance.test.ts) left the
// recorder still alphabetical, so golden-corpus.json baked the defect in — the
// corpus asserted the broken behavior and replay matched error-to-error. Both
// arms now import this ordering so they cannot drift.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

/** Ops that DESTROY the pre-seeded fixture sessions (which the harness cannot
 * re-create over the wire — the fakes are injected in-process in
 * daemon-runner.ts). They MUST iterate LAST so every session-dependent op
 * reaches its SUCCESS path first. closeAllSessions is dead last (it closes
 * everything); closeSession precedes it. */
export const SESSION_DESTROYING_OPS = ['closeSession', 'closeAllSessions'] as const

/** Deterministic iteration order for the 30 ops: everything else alphabetical,
 * then the session-destroying ops last (in the fixed order above). Used by both
 * conformance.test.ts and corpus/record-corpus.ts so the live suite and the
 * recorded corpus can never diverge on ordering again. */
export function orderedOperationNames(operations: Record<string, unknown>): string[] {
  const destroyers = SESSION_DESTROYING_OPS as readonly string[]
  return [
    ...Object.keys(operations)
      .filter((op) => !destroyers.includes(op))
      .sort(),
    ...destroyers.filter((op) => op in operations),
  ]
}
