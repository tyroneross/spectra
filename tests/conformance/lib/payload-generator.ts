// tests/conformance/lib/payload-generator.ts
//
// M2B — generates request payloads FOR EVERY contract operation directly from
// the M1 enriched param schema (src/contract/contract.spec.json ->
// ParamFieldSchema), so the conformance suite's inputs are derived from the
// oracle source of truth rather than hand-authored per operation.
//
// Two payload classes per operation:
//  - `validPayloads(op)`  — boundary-covering VALID payloads: a "minimal"
//    variant (required fields only) and a "full" variant (every optional
//    field present too); one of each PER ARM for a discriminated-union root
//    (library/demo/computerUse).
//  - `invalidPayloads(op)` — one payload per operation with a required field
//    removed (when the operation has any required fields), used to assert the
//    daemon never produces a response outside its declared error taxonomy.
//
// Domain-specific field values (sessionId, elementId, recordingId, file
// paths, ...) are resolved through a small named-hint table
// (FIELD_VALUE_HINTS) backed by the seeded conformance fixture (see
// daemon-runner.ts). Everything else is synthesized generically from the
// field's structural `kind` — this is what makes the generator scale to all
// 30 ops without 30 hand-written payload literals.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import type { ParamFieldSchema } from '../../../src/contract/enriched-spec.js'

// M3.G2 (S7) — read ONLY at module load (same rule as
// tests/conformance/lib/external-mode.ts's `milestoneG2`/`proxyFidelityMode`
// flags): gates the `fake:` createSession target branch below. Default
// (unset) is byte-identical to the pre-G2 behavior — every `target` payload
// resolves to `ctx.localWebFixtureUrl`, exactly as before this flag existed.
const milestoneG2 = process.env.SPECTRA_CONFORMANCE_MILESTONE === 'g2'

// [ASSUMED name, reversible — docs/plans/m3-g2-plan.md §Env Contract]
// optional override for the exact `fake:`-prefixed target string, so a
// caller can point at a specific seeded fixture id if ConnectOps.swift (S1)
// ever needs one beyond a bare `fake:` sentinel. Defaults to the plan's own
// example string.
const FAKE_TARGET_DEFAULT = 'fake:conformance-seed'
function fakeSeedTarget(): string {
  return process.env.SPECTRA_CONFORMANCE_FAKE_TARGET ?? FAKE_TARGET_DEFAULT
}

export interface GeneratorContext {
  /** A sessionId backed by a real (fake-driver) 'web' session in the daemon fixture. */
  webSessionId: string
  /** A sessionId backed by a real (fake-driver) 'macos' session, target.appName set — required by startRecording. */
  macosSessionId: string
  /** A pristine, pre-seeded (2 conformant steps) 'web' session for getSession/
   * getRun — never mutated by any test, so read-op nested-shape validation is
   * deterministic and immune to malformed-payload pollution of `webSessionId`. */
  readonlySessionId: string
  elementId: string
  /** A recordingId obtained from a prior (fixture-seeded) startRecording call, or undefined if none. */
  recordingId?: string
  /** Scratch directory the harness may read/write fixture files under. */
  scratchDir: string
  /**
   * A `http://127.0.0.1:<port>/...` URL backed by an in-process static HTML
   * server (see lib/fixture-context.ts's `startLocalWebFixtureServer`) —
   * used as the `target` payload value for `createSession`. Deliberately NOT
   * a real internet URL: `createSession`'s generic per-op test exercises the
   * real CdpDriver (real Chrome launch), and pointing it at a real external
   * domain made the corpus non-deterministic for reasons that have nothing
   * to do with daemon logic — page-load completion raced against real
   * network latency, so `elementCount`/`snapshot` legitimately differed
   * between the recorded corpus and a later replay purely on network
   * timing (discovered live while completing M2B). A same-machine HTTP
   * fixture with fixed content removes the network dependency entirely
   * while still exercising the identical createSession → CdpDriver.connect()
   * → AX-stabilize code path.
   */
  localWebFixtureUrl: string
}

export interface GeneratedPayload {
  /** Human-readable variant label, e.g. "minimal", "full", "arm:click/minimal". */
  label: string
  params: unknown
}

// ─── Named field hints ──────────────────────────────────────────────────────
// Keyed by the property NAME as it appears anywhere in a param schema. Used
// only when present — every other field falls back to the generic
// kind-based synthesizer below.
function namedHint(key: string, ctx: GeneratorContext): unknown | typeof NO_HINT {
  switch (key) {
    case 'sessionId':
      return ctx.webSessionId
    case 'elementId':
      return ctx.elementId
    case 'recordingId':
      return ctx.recordingId ?? 'unknown-recording-id'
    case 'target':
      // M3.G2 (S7, seed-gated — plan §Depends-on: "payload-generator's
      // 'target' case always emits the web fixture URL"): under the g2
      // milestone gate, route the generic per-op suite's createSession
      // payload at a `fake:` target instead, so it exercises the Swift
      // daemon's OWN native createSession (ADR-06's FakeDriver seam) rather
      // than a web/CDP target the standalone Swift G2 daemon has no driver
      // for. Gate-off (default, milestone env unset): unchanged
      // `ctx.localWebFixtureUrl` behavior, byte-for-byte identical to before
      // this branch existed.
      if (milestoneG2) return fakeSeedTarget()
      // See GeneratorContext.localWebFixtureUrl doc comment — a same-machine
      // HTTP fixture, not a real internet URL. Note this MUST start with
      // "http://" or "https://" (src/mcp/context.ts's detectPlatform regex
      // `/^https?:\/\//`) so createSession resolves to platform:'web' /
      // driverType:'cdp' — 'about:blank' was tried and rejected here because
      // it falls through detectPlatform to platform:'macos', silently
      // testing an entirely different (native AX) code path instead.
      return ctx.localWebFixtureUrl
    case 'app':
    case 'appA':
    case 'appB':
      return 'Fake Conformance App'
    case 'input':
    case 'sourcePath':
      return `${ctx.scratchDir}/fixture-input.mp4`
    case 'out':
    case 'outPath':
      return `${ctx.scratchDir}/fixture-output.mp4`
    case 'outDir':
      return `${ctx.scratchDir}/fixture-export`
    // `outputDir` (discover, recordTerminal) is passed straight to a real
    // `mkdir(outputDir, {recursive:true})` — WITHOUT this hint it fell
    // through to the generic string fallback below, which created a real
    // "conformance-test-string/" directory (with real .cast files inside it)
    // in the repo's working directory during harness development. Anchoring
    // it to scratchDir is what keeps every filesystem side effect inside the
    // per-run temp directory tests/conformance cleans up afterward.
    case 'outputDir':
      return `${ctx.scratchDir}/fixture-output-dir`
    case 'command':
      return 'echo spectra-conformance'
    case 'cdpUrl':
      return 'http://127.0.0.1:0/conformance-fixture'
    case 'id':
      return 'conformance-fixture-id'
    case 'showcasePath':
      return `${ctx.scratchDir}/fixture-showcase`
    case 'captionPngPath':
      return `${ctx.scratchDir}/fixture-caption.png`
    case 'file':
      return `${ctx.scratchDir}/fixture-recording.cast`
    case 'watch_files':
      // Real strings would be fine (recordTerminal only polls mtimes, never
      // creates them) but an empty array is the least assumption-laden valid
      // value for an optional string[].
      return []
    case 'usage':
      return { promptTokens: 1, completionTokens: 1 }
    case 'key':
      return 'return'
    case 'label':
      return 'Fake Button'
    case 'value':
      return 'conformance-value'
    default:
      return NO_HINT
  }
}
const NO_HINT = Symbol('no-hint')

// ─── Generic kind-based value synthesis ────────────────────────────────────

function sampleScalar(node: ParamFieldSchema): unknown {
  switch (node.kind) {
    case 'string':
      return 'conformance-test-string'
    case 'number':
      return 1
    case 'boolean':
      return true
    case 'null':
      return null
    case 'void':
      return undefined
    case 'unknown':
    case 'any':
      return { conformance: true }
    case 'json-value':
      return { conformance: true }
    case 'literal':
      return node.value
    case 'enum':
      return node.values[0]
    case 'unresolved':
      return null
    default:
      return null
  }
}

/** Synthesize ONE concrete value for `node`, using `key` (the enclosing
 * property name, if any) to consult the named-hint table first. */
export function sampleValue(
  node: ParamFieldSchema,
  ctx: GeneratorContext,
  key: string | undefined,
  includeOptional: boolean,
): unknown {
  if (key !== undefined) {
    const hint = namedHint(key, ctx)
    if (hint !== NO_HINT) return hint
  }

  switch (node.kind) {
    case 'array': {
      const item = sampleValue(node.items, ctx, undefined, includeOptional)
      return [item]
    }
    case 'object':
      return buildObject(node, ctx, includeOptional)
    case 'record': {
      const value = sampleValue(node.valueType, ctx, undefined, includeOptional)
      return { 'conformance-key': value }
    }
    case 'union':
      return sampleValue(node.options[0], ctx, key, includeOptional)
    case 'discriminatedUnion':
      return sampleValue(node.options[0], ctx, key, includeOptional)
    default:
      return sampleScalar(node)
  }
}

// Fields that are NEVER populated, even in the "full" (every-optional-field)
// variant, because populating them triggers a real side effect this harness
// must not cause: `createSession.repoPath`, if present, makes
// src/mcp/tools/connect.ts call `launchRepo(repoPath)` — which detects a
// project type from the path and SPAWNS a real dev-server/app process. It is
// always optional, so omitting it is a fully valid payload; the risk isn't
// worth exercising for a field whose presence doesn't change the operation's
// declared result/error SHAPE.
const NEVER_POPULATE_KEYS = new Set(['repoPath'])

function buildObject(
  node: Extract<ParamFieldSchema, { kind: 'object' }>,
  ctx: GeneratorContext,
  includeOptional: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [propKey, propNode] of Object.entries(node.properties)) {
    const isRequired = node.required.includes(propKey)
    if (!isRequired && !includeOptional) continue
    if (NEVER_POPULATE_KEYS.has(propKey)) continue
    out[propKey] = sampleValue(propNode, ctx, propKey, includeOptional)
  }
  return out
}

// ─── Per-operation payload generation ──────────────────────────────────────

function armLabel(option: ParamFieldSchema): string {
  if (option.kind !== 'object') return 'arm'
  const discriminatorField = Object.entries(option.properties).find(
    ([, v]) => v.kind === 'literal',
  )
  if (!discriminatorField) return 'arm'
  return String((discriminatorField[1] as Extract<ParamFieldSchema, { kind: 'literal' }>).value)
}

export function validPayloads(root: ParamFieldSchema, ctx: GeneratorContext): GeneratedPayload[] {
  if (root.kind === 'void') {
    return [{ label: 'void', params: undefined }]
  }

  if (root.kind === 'discriminatedUnion') {
    const payloads: GeneratedPayload[] = []
    for (const option of root.options) {
      const label = armLabel(option)
      payloads.push({ label: `arm:${label}/minimal`, params: sampleValue(option, ctx, undefined, false) })
    }
    // One "full" variant (first arm, every optional field populated) so at
    // least one boundary-complete payload is exercised per operation.
    payloads.push({
      label: `arm:${armLabel(root.options[0])}/full`,
      params: sampleValue(root.options[0], ctx, undefined, true),
    })
    return payloads
  }

  if (root.kind === 'object') {
    return [
      { label: 'minimal', params: buildObject(root, ctx, false) },
      { label: 'full', params: buildObject(root, ctx, true) },
    ]
  }

  // Fallback for any other top-level shape (none exist among the 30 ops
  // today — every param schema is object/discriminatedUnion/void).
  return [{ label: 'generic', params: sampleValue(root, ctx, undefined, true) }]
}

/** One payload per operation with a required field stripped (if any required
 * fields exist at the top level or within the first discriminated-union arm).
 * Used to prove the daemon never returns a response outside its declared
 * error taxonomy for malformed input. */
export function invalidPayloads(root: ParamFieldSchema, ctx: GeneratorContext): GeneratedPayload[] {
  const target = root.kind === 'discriminatedUnion' ? root.options[0] : root
  if (target.kind !== 'object' || target.required.length === 0) return []

  const full = buildObject(target, ctx, true)
  const payloads: GeneratedPayload[] = []
  for (const requiredKey of target.required) {
    const mutated = { ...full }
    delete mutated[requiredKey]
    payloads.push({ label: `missing:${requiredKey}`, params: mutated })
  }
  return payloads
}
