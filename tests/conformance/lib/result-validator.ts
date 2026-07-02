// tests/conformance/lib/result-validator.ts
//
// M2B — structural conformance check of a live daemon RESULT payload against
// the enriched spec's statically-parsed ResultShapeNode (src/contract/
// contract.spec.json .operations[op].result). This is the "response shape"
// half of the oracle; envelope shape is checked separately against the real
// zod envelope schemas in src/contract/schemas.ts (see conformance.test.ts).
//
// Strictness is intentionally uneven and DOCUMENTED per case, matching the
// same distinction enriched-spec.ts already draws (shapeHasStructure): a
// property with an expanded `.type` node gets a real structural check;  a
// bare `typeText` string (an opaque alias like `TimestampMs`, or a
// primitive-array like `string[]`) gets the strongest check that's honestly
// possible without adding a second type-resolution engine to the harness.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import type { ResultPropertyDescriptor, ResultShapeNode } from '../../../src/contract/enriched-spec.js'

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

function fail(path: string, message: string): ValidationResult {
  return { ok: false, issues: [{ path, message }] }
}

const ok: ValidationResult = { ok: true, issues: [] }

function merge(results: ValidationResult[]): ValidationResult {
  const issues = results.flatMap((r) => r.issues)
  return { ok: issues.length === 0, issues }
}

// Known opaque `typeText` aliases whose runtime representation we can check
// without expanding them structurally (they resolve to a primitive or a
// string-literal-union at the type level, per src/contract/core-api.ts /
// wire.ts). Anything NOT in this table is checked permissively
// (`value !== undefined` when required) — labeled as such in `validateLeaf`.
const KNOWN_ALIAS_KINDS: Record<string, 'string' | 'number' | 'boolean'> = {
  TimestampMs: 'number',
  Platform: 'string',
  PermissionKind: 'string',
  PermissionState: 'string',
  RecordingKind: 'string',
  CapturePreset: 'string',
  CaptureRunRecordingState: 'string',
  CaptureRunPlannerSource: 'string',
  CaptureRunDecisionOutcome: 'string',
  ActionType: 'string',
  ComputerUseAxStatus: 'string',
  JsonObject: 'string', // placeholder — overridden to object check below
}

function validateLeaf(typeText: string, value: unknown, path: string): ValidationResult {
  const trimmed = typeText.trim()

  if (trimmed === 'string') return typeof value === 'string' ? ok : fail(path, `expected string, got ${typeof value}`)
  if (trimmed === 'number') return typeof value === 'number' ? ok : fail(path, `expected number, got ${typeof value}`)
  if (trimmed === 'boolean') return typeof value === 'boolean' ? ok : fail(path, `expected boolean, got ${typeof value}`)
  if (trimmed === 'true') return value === true ? ok : fail(path, 'expected literal true')
  if (trimmed === 'false') return value === false ? ok : fail(path, 'expected literal false')
  if (trimmed === 'null') return value === null ? ok : fail(path, 'expected null')

  if (trimmed === 'JsonObject' || trimmed === 'JsonValue') {
    return value !== undefined ? ok : fail(path, 'expected a JSON value, got undefined')
  }

  if (trimmed.endsWith('[]')) {
    // Bare primitive array (no expanded `.type` was attached — see
    // shapeHasStructure in enriched-spec.ts). Element-type-blind by design.
    return Array.isArray(value) ? ok : fail(path, `expected array (${trimmed}), got ${typeof value}`)
  }

  if (trimmed in KNOWN_ALIAS_KINDS) {
    const expected = KNOWN_ALIAS_KINDS[trimmed]
    return typeof value === expected ? ok : fail(path, `expected ${expected} (alias ${trimmed}), got ${typeof value}`)
  }

  // Opaque named alias / string-literal union we don't have a runtime rule
  // for (e.g. `'ax' | 'vision'`, `DemoScriptAction['kind']`). Permissive:
  // presence-only check. This is the honestly-labeled weak spot in the
  // validator — a Swift port returning the wrong literal value here would
  // NOT be caught structurally, only by the dual-run corpus diff.
  return value !== undefined ? ok : fail(path, `expected a defined value for opaque type ${trimmed}, got undefined`)
}

function validateProperty(prop: ResultPropertyDescriptor, value: unknown, path: string): ValidationResult {
  if (value === undefined) {
    return prop.optional ? ok : fail(path, `required property "${prop.name}" is missing`)
  }
  if (prop.type) return validateShape(prop.type, value, path)
  return validateLeaf(prop.typeText, value, path)
}

export function validateShape(node: ResultShapeNode, value: unknown, path = '$'): ValidationResult {
  switch (node.kind) {
    case 'interface': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return fail(path, `expected an object (${node.typeName}), got ${Array.isArray(value) ? 'array' : typeof value}`)
      }
      const record = value as Record<string, unknown>
      const results = node.properties.map((prop) =>
        validateProperty(prop, record[prop.name], `${path}.${prop.name}`),
      )
      return merge(results)
    }
    case 'union': {
      const attempts = node.members.map((member) => validateShape(member, value, path))
      if (attempts.some((a) => a.ok)) return ok
      return fail(
        path,
        `value matched none of ${node.members.length} union members: ${attempts
          .map((a) => a.issues.map((i) => i.message).join('; '))
          .join(' | ')}`,
      )
    }
    case 'array': {
      if (!Array.isArray(value)) return fail(path, `expected array, got ${typeof value}`)
      // Permissive on emptiness (a legitimately empty result array is valid);
      // when non-empty, every element must match the item shape.
      const results = value.map((item, i) => validateShape(node.items, item, `${path}[${i}]`))
      return merge(results)
    }
    case 'tuple': {
      if (!Array.isArray(value) || value.length !== node.elements.length) {
        return fail(path, `expected a ${node.elements.length}-tuple, got ${Array.isArray(value) ? `array(${value.length})` : typeof value}`)
      }
      const results = node.elements.map((el, i) => validateShape(el, value[i], `${path}[${i}]`))
      return merge(results)
    }
    case 'literal':
      // D3: an exact-value gate. A result property typed as a literal (or a
      // union of literals, e.g. PermissionState / RecordingKind / mode) is now
      // checked against its allowed VALUE — not just `typeof`. A Swift port
      // returning `"grantd"` for a PermissionState is caught here, where before
      // it slipped through the opaque-alias `typeof === 'string'` check.
      return value === node.value
        ? ok
        : fail(path, `expected literal ${JSON.stringify(node.value)}, got ${JSON.stringify(value)}`)
    case 'unresolved':
      // No structural information available (max-depth guard, or a type the
      // static parser couldn't resolve) — permissive by construction.
      return ok
    default:
      return ok
  }
}
