// src/contract/contract.test.ts
//
// FREEZE / drift gate. Fails if the daemon contract surface changes without a
// matching update to contract.snapshot.json. Run on every `npm test`.
//
// The snapshot is generated from `contractSurface()`. This test re-derives the
// live surface and asserts deep equality, plus three independent cross-checks
// against the runtime values in wire.ts so the freeze bites even if the
// snapshot and schemas.ts drift together:
//   1. operations  === Object.keys(operationCapabilities)   (wire.ts is BE-owned)
//   2. apiVersion   === API_VERSION                          (wire.ts single source)
//   3. every operation has a param schema in schemas.ts
//
// To intentionally change the contract: update wire.ts / core-api.ts, then
// regenerate the snapshot and commit both. There is no `--no-verify` path.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  API_VERSION,
  apiOperations,
  contractSurface,
  operationParamSchemas,
  type ContractSurface,
} from './schemas.js'
import { operationCapabilities } from './wire.js'

const here = dirname(fileURLToPath(import.meta.url))
const snapshotPath = join(here, 'contract.snapshot.json')

function loadSnapshot(): ContractSurface {
  return JSON.parse(readFileSync(snapshotPath, 'utf8')) as ContractSurface
}

describe('contract freeze — drift gate', () => {
  const snapshot = loadSnapshot()
  const live = contractSurface()

  it('snapshot deep-equals the live contract surface (regenerate snapshot to change)', () => {
    expect(live).toEqual(snapshot)
  })

  it('apiVersion matches the wire single source (API_VERSION)', () => {
    expect(snapshot.apiVersion).toBe(API_VERSION)
    expect(live.apiVersion).toBe(API_VERSION)
  })

  it('operations match wire.ts operationCapabilities keys exactly (BE-owned surface)', () => {
    const wireOps = Object.keys(operationCapabilities).sort()
    expect(snapshot.operations).toEqual(wireOps)
    expect(apiOperations).toEqual(wireOps)
  })

  it('every frozen operation has a param schema in schemas.ts', () => {
    const schemaKeys = Object.keys(operationParamSchemas).sort()
    expect(schemaKeys).toEqual(snapshot.operations)
  })

  it('no operation was added or removed without updating the snapshot', () => {
    expect(live.operations.length).toBe(snapshot.operations.length)
    expect(new Set(live.operations)).toEqual(new Set(snapshot.operations))
  })

  it('capability, error-code, event-type, and client-surface vocab is frozen', () => {
    expect(live.capabilities).toEqual(snapshot.capabilities)
    expect(live.errorCodes).toEqual(snapshot.errorCodes)
    expect(live.eventTypes).toEqual(snapshot.eventTypes)
    expect(live.clientSurfaces).toEqual(snapshot.clientSurfaces)
  })

  it('wire routes + envelope field sets are frozen', () => {
    expect(live.routes).toEqual(snapshot.routes)
    expect(live.envelopes).toEqual(snapshot.envelopes)
  })
})
