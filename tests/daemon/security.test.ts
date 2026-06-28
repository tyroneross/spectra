import { describe, expect, it } from 'vitest'
import type { VerifiedCaller } from '../../src/contract/wire.js'
import {
  CapabilityDeniedError,
  assertCallerCanInvoke,
  authorizeBearerHeader,
  callerCanInvoke,
  isAllowedOrigin,
  isLoopbackHost,
  missingCapabilitiesForOperation,
  normalizeHostHeader,
  requiredCapabilitiesForOperation,
  verifyLoopbackRequest,
} from '../../src/daemon/security.js'

describe('daemon loopback security helpers', () => {
  it('normalizes loopback Host headers without accepting lookalike domains', () => {
    expect(normalizeHostHeader('127.0.0.1:47823')).toBe('127.0.0.1')
    expect(normalizeHostHeader('[::1]:47823')).toBe('::1')
    expect(normalizeHostHeader('LOCALHOST.')).toBe('localhost')
    expect(isLoopbackHost('127.0.0.1:47823')).toBe(true)
    expect(isLoopbackHost('[::1]:47823')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.0.0.1.evil.test')).toBe(false)
    expect(isLoopbackHost('spectra.local')).toBe(false)
  })

  it('allows absent or loopback Origin headers and rejects malformed/non-loopback origins', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin('http://localhost:4300')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:4300')).toBe(true)
    expect(isAllowedOrigin('http://[::1]:4300')).toBe(true)
    expect(isAllowedOrigin('http://example.test')).toBe(false)
    expect(isAllowedOrigin('not a url')).toBe(false)
  })

  it('uses daemon bearer token comparison for Authorization headers', () => {
    expect(authorizeBearerHeader('Bearer abc123', 'abc123')).toBe(true)
    expect(authorizeBearerHeader('bearer abc123', 'abc123')).toBe(true)
    expect(authorizeBearerHeader('Bearer wrong', 'abc123')).toBe(false)
    expect(authorizeBearerHeader(undefined, 'abc123')).toBe(false)
  })

  it('verifies host, origin, and bearer token before returning a caller', () => {
    const ok = verifyLoopbackRequest(
      {
        host: '127.0.0.1:47823',
        origin: 'http://localhost:4300',
        authorization: 'Bearer dev-token',
      },
      'dev-token',
      { capabilities: ['daemon:read'], surface: 'cli', tokenId: 'local' },
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.caller).toMatchObject({
        surface: 'cli',
        verifiedBy: 'bearer-token',
        capabilities: ['daemon:read'],
        tokenId: 'local',
      })
    }

    const badHost = verifyLoopbackRequest(
      { host: 'example.test', authorization: 'Bearer dev-token' },
      'dev-token',
    )
    expect(badHost).toMatchObject({ ok: false, status: 403 })

    const badToken = verifyLoopbackRequest(
      { host: '127.0.0.1', authorization: 'Bearer wrong-token' },
      'dev-token',
    )
    expect(badToken).toMatchObject({ ok: false, status: 401 })
  })
})

describe('daemon capability default-deny policy', () => {
  const caller = (capabilities: VerifiedCaller['capabilities']): VerifiedCaller => ({
    surface: 'test',
    verifiedBy: 'bearer-token',
    capabilities,
  })

  it('exposes the wire-contract capability requirements for an operation', () => {
    expect(requiredCapabilitiesForOperation('createSession')).toEqual(['sessions:write', 'ui:read'])
    expect(requiredCapabilitiesForOperation('recordComposite')).toEqual(['media:record', 'windows:read'])
    expect(requiredCapabilitiesForOperation('getRecording')).toEqual(['sessions:read'])
  })

  it('denies operations until every required capability is granted', () => {
    expect(callerCanInvoke(caller(['sessions:write']), 'createSession')).toBe(false)
    expect(missingCapabilitiesForOperation(caller(['sessions:write']), 'createSession')).toEqual(['ui:read'])
    expect(callerCanInvoke(caller(['sessions:write', 'ui:read']), 'createSession')).toBe(true)
  })

  it('throws a typed error for denied operations', () => {
    expect(() => assertCallerCanInvoke(caller(['daemon:read']), 'library')).toThrow(CapabilityDeniedError)
  })
})
