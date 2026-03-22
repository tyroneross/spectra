import { describe, it, expect } from 'vitest'
import * as spectra from '../src/index.js'

describe('library exports', () => {
  it('exports core classes and functions', () => {
    expect(spectra.SessionManager).toBeDefined()
    expect(spectra.resolve).toBeDefined()
    expect(spectra.CdpDriver).toBeDefined()
    expect(spectra.NativeDriver).toBeDefined()
    expect(spectra.SimDriver).toBeDefined()
    expect(spectra.normalizeRole).toBeDefined()
    expect(spectra.serializeSnapshot).toBeDefined()
    expect(spectra.serializeElement).toBeDefined()
    expect(spectra.getStoragePath).toBeDefined()
    expect(spectra.findProjectRoot).toBeDefined()
  })

  it('exports are the correct types', () => {
    expect(typeof spectra.resolve).toBe('function')
    expect(typeof spectra.normalizeRole).toBe('function')
    expect(typeof spectra.serializeSnapshot).toBe('function')
    expect(typeof spectra.serializeElement).toBe('function')
    expect(typeof spectra.getStoragePath).toBe('function')
    expect(typeof spectra.findProjectRoot).toBe('function')
  })

  it('SessionManager is a class (constructable)', () => {
    expect(typeof spectra.SessionManager).toBe('function')
    expect(spectra.SessionManager.prototype).toBeDefined()
  })

  it('driver classes are constructable', () => {
    expect(typeof spectra.CdpDriver).toBe('function')
    expect(typeof spectra.NativeDriver).toBe('function')
    expect(typeof spectra.SimDriver).toBe('function')
  })
})
