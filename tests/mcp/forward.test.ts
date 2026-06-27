// tests/mcp/forward.test.ts
//
// Tests the pure tool → operation mapping and the end-to-end forward through a
// DaemonClient against the mock daemon. Every MCP tool maps to exactly one
// frozen-contract operation; dispatched tools (capture/session/demo) resolve by
// their type/action field.

import { describe, it, expect, afterEach } from 'vitest'
import { mapToolCall, forwardTool, ToolMappingError } from '../../src/mcp/forward.js'
import { DaemonClient } from '../../src/client/daemon-client.js'
import { startMockDaemon, type MockDaemon } from '../helpers/mock-daemon.js'
import { operationCapabilities } from '../../src/contract/wire.js'

let daemon: MockDaemon | undefined
afterEach(async () => { await daemon?.close().catch(() => {}); daemon = undefined })

describe('mapToolCall — 1:1 tools', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['spectra_connect', { target: 'http://x' }, 'createSession'],
    ['spectra_snapshot', { sessionId: 's' }, 'snapshot'],
    ['spectra_act', { sessionId: 's', elementId: 'e1', action: 'click' }, 'act'],
    ['spectra_step', { sessionId: 's', intent: 'go' }, 'step'],
    ['spectra_analyze', { sessionId: 's' }, 'analyze'],
    ['spectra_discover', { sessionId: 's' }, 'discover'],
    ['spectra_walkthrough', { sessionId: 's', steps: [] }, 'walkthrough'],
    ['spectra_llm_step', { sessionId: 's', actions: [] }, 'llmStep'],
    ['spectra_record', { command: 'ls' }, 'recordTerminal'],
    ['spectra_replay', { file: 'a.cast' }, 'replayTerminal'],
    ['spectra_library', { action: 'status' }, 'library'],
  ]
  it.each(cases)('%s → %s', (tool, args, operation) => {
    expect(mapToolCall(tool, args).operation).toBe(operation)
  })
})

describe('mapToolCall — dispatched tools', () => {
  it('spectra_capture dispatches by type', () => {
    expect(mapToolCall('spectra_capture', { sessionId: 's', type: 'screenshot' }).operation).toBe('screenshot')
    expect(mapToolCall('spectra_capture', { sessionId: 's', type: 'start_recording' }).operation).toBe('startRecording')
    expect(mapToolCall('spectra_capture', { sessionId: 's', type: 'stop_recording' }).operation).toBe('stopRecording')
  })

  it('spectra_session dispatches by action', () => {
    expect(mapToolCall('spectra_session', { action: 'list' }).operation).toBe('listSessions')
    expect(mapToolCall('spectra_session', { action: 'get', sessionId: 's' }).operation).toBe('getSession')
    expect(mapToolCall('spectra_session', { action: 'run', sessionId: 's' }).operation).toBe('getRun')
    expect(mapToolCall('spectra_session', { action: 'close', sessionId: 's' }).operation).toBe('closeSession')
    expect(mapToolCall('spectra_session', { action: 'close_all' }).operation).toBe('closeAllSessions')
    expect(mapToolCall('spectra_session', { action: 'record_llm_usage', sessionId: 's', usage: {} }).operation).toBe('recordLlmUsage')
  })

  it('spectra_demo maps to the demo operation for every action', () => {
    for (const action of ['scan', 'polish', 'auto-ramp', 'record-composite']) {
      expect(mapToolCall('spectra_demo', { action }).operation).toBe('demo')
    }
  })

  it('throws ToolMappingError on unknown tool / dispatch value', () => {
    expect(() => mapToolCall('spectra_nope', {})).toThrow(ToolMappingError)
    expect(() => mapToolCall('spectra_capture', { type: 'bogus' })).toThrow(ToolMappingError)
    expect(() => mapToolCall('spectra_session', { action: 'bogus' })).toThrow(ToolMappingError)
  })
})

describe('mapToolCall — every mapped operation is a real contract operation', () => {
  it('all 1:1 + dispatched targets exist in operationCapabilities', () => {
    const targets = [
      'createSession', 'snapshot', 'act', 'step', 'analyze', 'discover', 'walkthrough', 'llmStep',
      'recordTerminal', 'replayTerminal', 'library', 'screenshot', 'startRecording', 'stopRecording',
      'listSessions', 'getSession', 'getRun', 'closeSession', 'closeAllSessions', 'recordLlmUsage', 'demo',
    ]
    for (const op of targets) expect(operationCapabilities).toHaveProperty(op)
  })
})

describe('forwardTool — end-to-end over the mock daemon', () => {
  it('connect → createSession round-trips through the socket', async () => {
    daemon = await startMockDaemon()
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'stdio-mcp' })
    const res = (await forwardTool(client, 'spectra_connect', { target: 'http://localhost:3000' })) as { sessionId: string }
    expect(res.sessionId).toBe('mock-session-1')
    expect(daemon.calls[0].operation).toBe('createSession')
  })

  it('capture start_recording forwards startRecording params', async () => {
    daemon = await startMockDaemon()
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'stdio-mcp' })
    await forwardTool(client, 'spectra_capture', { sessionId: 's1', type: 'start_recording', fps: 60, codec: 'h264' })
    expect(daemon.calls[0].operation).toBe('startRecording')
    expect(daemon.calls[0].params).toMatchObject({ sessionId: 's1', fps: 60, codec: 'h264' })
  })

  it('session close_all forwards closeAllSessions with no params', async () => {
    daemon = await startMockDaemon()
    const client = new DaemonClient({ socketPath: daemon.socketPath, surface: 'stdio-mcp' })
    const res = (await forwardTool(client, 'spectra_session', { action: 'close_all' })) as { success: boolean }
    expect(res.success).toBe(true)
    expect(daemon.calls[0].operation).toBe('closeAllSessions')
  })
})
