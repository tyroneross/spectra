// tests/contract/enriched-spec.test.ts
//
// M1b — freeze/drift gate for the enriched machine-checkable contract spec
// (src/contract/contract.spec.json), plus a mutation check proving the
// enriched descriptor catches semantic changes (type/optionality) that
// contract.snapshot.json's names-only surface cannot.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  buildEnrichedSpec,
  buildEnrichedSpecBody,
  describeParamSchema,
  hashSpecBody,
  type EnrichedContractSpec,
} from '../../src/contract/enriched-spec.js'
import { apiOperations, contractSurface, createSessionParamsSchema } from '../../src/contract/schemas.js'

const here = dirname(fileURLToPath(import.meta.url))
const specPath = join(here, '..', '..', 'src', 'contract', 'contract.spec.json')

function loadCommittedSpec(): EnrichedContractSpec {
  return JSON.parse(readFileSync(specPath, 'utf8')) as EnrichedContractSpec
}

describe('enriched contract spec — freeze / drift gate', () => {
  const committed = loadCommittedSpec()
  const live = buildEnrichedSpec()

  it('regenerating from live zod schemas + core-api.ts reproduces the committed artifact byte-for-byte', () => {
    expect(live).toEqual(committed)
  })

  it('the hash is a pure function of the spec body (no timestamps / non-determinism)', () => {
    const bodyOnly: Record<string, unknown> = { ...committed }
    delete bodyOnly.hash
    expect(hashSpecBody(bodyOnly as ReturnType<typeof buildEnrichedSpecBody>)).toBe(committed.hash)
    // Regenerating twice in the same process yields the same hash.
    expect(buildEnrichedSpec().hash).toBe(live.hash)
  })

  it('covers all 30 contract operations', () => {
    expect(Object.keys(committed.operations).sort()).toEqual([...apiOperations].sort())
    expect(Object.keys(committed.operations)).toHaveLength(30)
  })

  it('captures optionality the names-only snapshot cannot express', () => {
    const createSession = committed.operations.createSession.params
    expect(createSession.kind).toBe('object')
    if (createSession.kind !== 'object') throw new Error('unreachable')
    expect(createSession.properties.target.optional).toBeUndefined()
    expect(createSession.properties.name.optional).toBe(true)
    expect(createSession.required).toEqual(['target'])
  })

  it('captures literal-union types (e.g. startRecording.fps: 30 | 60)', () => {
    const fps = committed.operations.startRecording.params
    if (fps.kind !== 'object') throw new Error('unreachable')
    expect(fps.properties.fps).toEqual({ kind: 'union', options: [
      { kind: 'literal', value: 30 },
      { kind: 'literal', value: 60 },
    ], optional: true })
  })

  it('expands discriminated-union operations (library/demo/computerUse) into real per-action shapes', () => {
    // The legacy snapshot intentionally leaves these as `[]` at the top level
    // (see contract.test.ts) because objectParamKeys() only handles ZodObject.
    // The enriched spec has no such blind spot.
    expect(committed.operations.library.params.kind).toBe('discriminatedUnion')
    expect(committed.operations.demo.params.kind).toBe('discriminatedUnion')
    expect(committed.operations.computerUse.params.kind).toBe('discriminatedUnion')
    if (committed.operations.library.params.kind === 'discriminatedUnion') {
      expect(committed.operations.library.params.options).toHaveLength(9)
    }
    if (committed.operations.demo.params.kind === 'discriminatedUnion') {
      expect(committed.operations.demo.params.options).toHaveLength(7)
    }
  })

  it('captures RESULT envelope shapes statically parsed from core-api.ts', () => {
    const result = committed.operations.createSession.result
    expect(result.kind).toBe('interface')
    if (result.kind !== 'interface') throw new Error('unreachable')
    expect(result.typeName).toBe('CreateSessionResult')
    expect(result.properties.map((p) => p.name).sort()).toEqual(
      ['elementCount', 'launched', 'platform', 'sessionId', 'snapshot'].sort(),
    )
  })

  it('H1: expands NESTED named result types one layer down instead of freezing them as a typeText string', () => {
    // Pre-fix, `launched` (and every other property whose type references a
    // declared interface) carried only `typeText: "LaunchInfo"` — the
    // resolver never looked up the `LaunchInfo` declaration behind that
    // string. A field added/removed inside LaunchInfo would leave this
    // property, and therefore the whole frozen spec, byte-identical.
    const createSessionResult = committed.operations.createSession.result
    if (createSessionResult.kind !== 'interface') throw new Error('unreachable')
    const launched = createSessionResult.properties.find((p) => p.name === 'launched')
    if (!launched?.type || launched.type.kind !== 'interface') {
      throw new Error('launched.type did not expand to the LaunchInfo interface shape')
    }
    expect(launched.type.typeName).toBe('LaunchInfo')
    expect(launched.type.properties.map((p) => p.name).sort()).toEqual(['appName', 'kind', 'pid', 'url'])

    // getSession.result.session: SessionRecord and .run: CaptureRunManifest | null
    // both expand too — proves the fix covers direct references AND
    // references nested inside a union.
    const getSessionResult = committed.operations.getSession.result
    if (getSessionResult.kind !== 'interface') throw new Error('unreachable')
    const session = getSessionResult.properties.find((p) => p.name === 'session')
    if (!session?.type || session.type.kind !== 'interface') throw new Error('session.type did not expand')
    expect(session.type.typeName).toBe('SessionRecord')
    expect(session.type.properties.map((p) => p.name)).toContain('steps')

    const run = getSessionResult.properties.find((p) => p.name === 'run')
    if (!run?.type || run.type.kind !== 'union') throw new Error('run.type did not expand to a union')
    const manifestMember = run.type.members.find((m) => m.kind === 'interface' && m.typeName === 'CaptureRunManifest')
    if (!manifestMember || manifestMember.kind !== 'interface') throw new Error('CaptureRunManifest member missing')
    expect(manifestMember.properties.map((p) => p.name)).toEqual(
      expect.arrayContaining(['decisions', 'actions', 'artifacts', 'events', 'recording']),
    )

    // Bounds ([number,number,number,number]) is a tuple alias, not an
    // interface — expands to a `tuple` shape (arity is the fact that
    // matters) rather than staying an opaque "Bounds" string.
    const computerUseResult = committed.operations.computerUse.result
    if (computerUseResult.kind !== 'union') throw new Error('unreachable')
    const snapshotMember = computerUseResult.members.find(
      (m) => m.kind === 'interface' && m.typeName === 'ComputerUseSnapshotResult',
    )
    if (!snapshotMember || snapshotMember.kind !== 'interface') throw new Error('ComputerUseSnapshotResult missing')
    const nodes = snapshotMember.properties.find((p) => p.name === 'nodes')
    if (!nodes?.type || nodes.type.kind !== 'array' || nodes.type.items.kind !== 'interface') {
      throw new Error('nodes.type did not expand to an array of ComputerUseNode')
    }
    const bounds = nodes.type.items.properties.find((p) => p.name === 'bounds')
    expect(bounds?.type).toEqual({
      kind: 'tuple',
      elements: [
        { kind: 'unresolved', typeName: 'number' },
        { kind: 'unresolved', typeName: 'number' },
        { kind: 'unresolved', typeName: 'number' },
        { kind: 'unresolved', typeName: 'number' },
      ],
    })
  })

  it('captures result shapes for union return types (recordComposite, computerUse, demo, library)', () => {
    expect(committed.operations.recordComposite.result.kind).toBe('union')
    expect(committed.operations.computerUse.result.kind).toBe('union')
    expect(committed.operations.demo.result.kind).toBe('union')
    expect(committed.operations.library.result.kind).toBe('union')
  })

  it('captures an op→error-code mapping the flat errorCodes list cannot express', () => {
    // Universal envelope-layer codes reach every operation...
    for (const op of apiOperations) {
      expect(committed.operations[op].errorCodes).toEqual(
        expect.arrayContaining(['bad_request', 'internal_error', 'daemon_unhealthy']),
      )
    }
    // ...and operation-specific codes are attributed only to the operations
    // that actually throw them in src/daemon/core-impl.ts.
    expect(committed.operations.getSession.errorCodes).toContain('not_found')
    expect(committed.operations.snapshot.errorCodes).not.toContain('not_found')
    expect(committed.operations.stopRecording.errorCodes).toContain('recording_failed')
    expect(committed.operations.computerUse.errorCodes).toContain('permission_denied')
  })
})

describe('mutation check — enriched spec detects semantics the legacy snapshot misses', () => {
  // Simulate two plausible drift mutations against createSessionParamsSchema
  // WITHOUT touching the real schemas.ts source (schemas.ts stays frozen for
  // this test; see the manual red/green verification note in the M1b report
  // for the live-source version of this same check).

  it('name: optional→required flips the enriched descriptor, but the legacy names-only surface is blind to it', () => {
    const original = createSessionParamsSchema
    const mutated = z.object({
      target: z.string(),
      name: z.string(), // was z.string().optional()
      record: z.boolean().optional(),
      repoPath: z.string().optional(),
    })

    const originalDescriptor = describeParamSchema(original)
    const mutatedDescriptor = describeParamSchema(mutated)

    expect(originalDescriptor).not.toEqual(mutatedDescriptor)
    if (originalDescriptor.kind === 'object' && mutatedDescriptor.kind === 'object') {
      expect(originalDescriptor.properties.name.optional).toBe(true)
      expect(mutatedDescriptor.properties.name.optional).toBeUndefined()
      expect(originalDescriptor.required).not.toContain('name')
      expect(mutatedDescriptor.required).toContain('name')
    }

    // The legacy contractSurface()/objectParamKeys mechanism only ever looks at
    // KEY NAMES (Object.keys(shape)), so it cannot see the optional→required
    // change: both schemas produce the identical key list.
    const objectParamKeysOf = (schema: z.ZodTypeAny): string[] => {
      if (schema instanceof z.ZodObject) return Object.keys(schema.shape).sort()
      return []
    }
    expect(objectParamKeysOf(mutated)).toEqual(objectParamKeysOf(original))
    // ...and it matches the frozen snapshot's createSession entry regardless
    // of the mutation, proving the drift is invisible to the old gate.
    expect(objectParamKeysOf(mutated)).toEqual(contractSurface().operationParams.createSession)
  })

  it('includePermissions: boolean→number flips the enriched descriptor kind, invisible to the legacy surface', () => {
    const original = z.object({ includePermissions: z.boolean().optional() })
    const mutated = z.object({ includePermissions: z.number().optional() }) // type-level drift

    const originalDescriptor = describeParamSchema(original)
    const mutatedDescriptor = describeParamSchema(mutated)
    expect(originalDescriptor).not.toEqual(mutatedDescriptor)
    if (originalDescriptor.kind === 'object' && mutatedDescriptor.kind === 'object') {
      expect(originalDescriptor.properties.includePermissions.kind).toBe('boolean')
      expect(mutatedDescriptor.properties.includePermissions.kind).toBe('number')
    }

    const objectParamKeysOf = (schema: z.ZodTypeAny): string[] => {
      if (schema instanceof z.ZodObject) return Object.keys(schema.shape).sort()
      return []
    }
    // Same key list either way — the legacy names-only mechanism cannot
    // distinguish a boolean param from a number param.
    expect(objectParamKeysOf(mutated)).toEqual(objectParamKeysOf(original))
  })
})

describe('H1 mutation regression — nested RESULT-type field drift is no longer silently invisible', () => {
  // `buildEnrichedSpecBody(coreApiSource)` accepts an in-memory core-api.ts
  // text override (test-only param — production callers always omit it and
  // read the real file). This lets us mutate a COPY of the real source, in
  // memory, and prove the resolver reacts, without ever touching
  // src/contract/core-api.ts on disk (out of this fix's ownership).
  const coreApiPath = join(here, '..', '..', 'src', 'contract', 'core-api.ts')
  const coreApiSource = readFileSync(coreApiPath, 'utf8')

  it('sanity check: passing the real file content back through the override reproduces the disk-read body exactly', () => {
    // Confirms the override parameter is a faithful substitution path (not a
    // second, divergently-behaving code path) before trusting the mutated
    // diff below as meaningful.
    expect(buildEnrichedSpecBody(coreApiSource)).toEqual(buildEnrichedSpecBody())
  })

  it('adding a field INSIDE SessionRecord (never itself a CoreApi top-level result — only reached via GetSessionResult.session) flips the frozen spec', () => {
    // SessionRecord is exactly the shape of type H1 described: not an
    // operation's own result type, but a named type NESTED one layer inside
    // one (getSession's result is GetSessionResult, whose `session` field is
    // typed SessionRecord). Pre-fix, `resolveInterfaceProperties` only ever
    // read `member.type.getText()` for that field ("SessionRecord" — a bare
    // string) and never looked up the SessionRecord declaration itself, so
    // this mutation was invisible to the freeze test. Post-fix, the
    // property's type node is resolved via `resolveTypeNode` too.
    const marker = 'export interface SessionRecord {'
    expect(coreApiSource).toContain(marker)
    const mutatedSource = coreApiSource.replace(marker, `${marker}\n  bogusMutationField?: string`)
    expect(mutatedSource).not.toBe(coreApiSource)

    const baseline = buildEnrichedSpecBody()
    const mutated = buildEnrichedSpecBody(mutatedSource)

    // The flipped assertion — RED against the pre-fix resolver (hashes equal,
    // this whole test fails), GREEN post-fix (hashes differ).
    expect(hashSpecBody(mutated)).not.toBe(hashSpecBody(baseline))
    expect(mutated).not.toEqual(baseline)

    const baselineResult = baseline.operations.getSession.result
    const mutatedResult = mutated.operations.getSession.result
    if (baselineResult.kind !== 'interface' || mutatedResult.kind !== 'interface') {
      throw new Error('unreachable')
    }
    const baselineSession = baselineResult.properties.find((p) => p.name === 'session')
    const mutatedSession = mutatedResult.properties.find((p) => p.name === 'session')
    if (!baselineSession?.type || baselineSession.type.kind !== 'interface') throw new Error('unreachable')
    if (!mutatedSession?.type || mutatedSession.type.kind !== 'interface') throw new Error('unreachable')

    expect(baselineSession.type.properties.map((p) => p.name)).not.toContain('bogusMutationField')
    expect(mutatedSession.type.properties.map((p) => p.name)).toContain('bogusMutationField')

    // Precision check: the mutation is scoped to SessionRecord and whatever
    // references it — an unrelated operation's result (health, which never
    // touches SessionRecord) is untouched. This isn't just a global re-hash
    // artifact of re-parsing the file.
    expect(mutated.operations.health.result).toEqual(baseline.operations.health.result)
  })
})
