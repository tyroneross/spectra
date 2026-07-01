// tests/mcp/computer-use-reachability.test.ts
//
// Proves spectra_computer_use is reachable END-TO-END at the REAL MCP input
// shape (anti-dormancy). Four layers, all against the actual code paths:
//   1. the MCP SDK boundary shape (spectraComputerUseInputShape) accepts the payload
//   2. forward.mapToolCall maps the tool → the `computerUse` contract operation
//   3. the strict daemon gate (computerUseParamsSchema) accepts it / rejects malformed
//   4. forwardTool round-trips through the mock daemon (frozen wire contract)

import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { spectraComputerUseInputShape } from '../../src/mcp/server.js'
import { mapToolCall, forwardTool } from '../../src/mcp/forward.js'
import { computerUseParamsSchema } from '../../src/contract/schemas.js'
import { operationCapabilities } from '../../src/contract/wire.js'
import { DaemonClient } from '../../src/client/daemon-client.js'
import { startMockDaemon, type MockDaemon } from '../helpers/mock-daemon.js'

const mcpInputSchema = z.object(spectraComputerUseInputShape)

const payloads = {
  snapshot: { action: 'snapshot', app: 'Notes' },
  act: { action: 'act', app: 'Notes', op: { kind: 'set-value', label: 'Email', value: 'a@b.com' } },
  fillForm: { action: 'fill-form', app: 'Notes', fields: { Email: 'a@b.com', Password: 'secret' } },
} as const

let daemon: MockDaemon | undefined
afterEach(async () => { await daemon?.close().catch(() => {}); daemon = undefined })

describe('spectra_computer_use — contract wiring', () => {
  it('is a real, capability-gated contract operation', () => {
    expect(operationCapabilities).toHaveProperty('computerUse')
    expect(operationCapabilities.computerUse).toEqual(['ui:read', 'ui:act'])
  })

  it('the MCP SDK boundary shape accepts snapshot / act / fill-form', () => {
    for (const p of Object.values(payloads)) {
      expect(mcpInputSchema.safeParse(p).success).toBe(true)
    }
  })

  it('maps to the computerUse operation for every action', () => {
    for (const p of Object.values(payloads)) {
      expect(mapToolCall('spectra_computer_use', p).operation).toBe('computerUse')
    }
  })

  it('the strict daemon gate accepts well-formed payloads', () => {
    for (const p of Object.values(payloads)) {
      expect(computerUseParamsSchema.safeParse(p).success).toBe(true)
    }
  })

  it('the strict daemon gate rejects malformed act/fill-form payloads', () => {
    // act missing required label for set-value
    expect(computerUseParamsSchema.safeParse({ action: 'act', op: { kind: 'set-value', value: 'x' } }).success).toBe(false)
    // fill-form with a non-string value
    expect(computerUseParamsSchema.safeParse({ action: 'fill-form', fields: { Email: 5 } }).success).toBe(false)
    // unknown action
    expect(computerUseParamsSchema.safeParse({ action: 'bogus' }).success).toBe(false)
  })
})

describe('spectra_computer_use — end-to-end over the mock daemon (frozen wire)', () => {
  it('forwards each action through the socket as operation=computerUse', async () => {
    daemon = await startMockDaemon()
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'stdio-mcp' })

    for (const p of Object.values(payloads)) {
      await forwardTool(client, 'spectra_computer_use', p)
    }
    expect(daemon.calls.map((c) => c.operation)).toEqual(['computerUse', 'computerUse', 'computerUse'])
    // params reached the daemon intact (the mock validates against computerUseParamsSchema)
    expect(daemon.calls[1].params).toMatchObject({ action: 'act', op: { kind: 'set-value', label: 'Email' } })
  })
})
