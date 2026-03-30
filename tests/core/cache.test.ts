import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResolutionCache } from '../../src/core/cache.js'

describe('ResolutionCache', () => {
  let cache: ResolutionCache

  beforeEach(() => {
    cache = new ResolutionCache()
  })

  it('get/set basic flow', () => {
    cache.set('click login', 'e5', { role: 'button', label: 'Log In', confidence: 0.9 })
    const result = cache.get('click login')
    expect(result).not.toBeNull()
    expect(result!.elementId).toBe('e5')
    expect(result!.role).toBe('button')
    expect(result!.label).toBe('Log In')
    expect(result!.confidence).toBe(0.9)
  })

  it('returns null for missing keys', () => {
    expect(cache.get('nonexistent intent')).toBeNull()
  })

  it('TTL expiration — returns null after TTL', () => {
    const shortCache = new ResolutionCache({ ttl: 50 })
    shortCache.set('intent', 'e1', { role: 'button', label: 'OK', confidence: 0.8 })

    // Manually advance createdAt to simulate expiry
    const entry = (shortCache as unknown as { cache: Map<string, { createdAt: number }> }).cache.get('intent')!
    entry.createdAt = Date.now() - 100 // 100ms ago, past the 50ms TTL

    expect(shortCache.get('intent')).toBeNull()
  })

  it('below-confidence threshold not cached', () => {
    cache.set('low conf', 'e1', { role: 'button', label: 'Maybe', confidence: 0.5 })
    expect(cache.get('low conf')).toBeNull()
  })

  it('exactly at minConfidence threshold is cached', () => {
    cache.set('boundary', 'e2', { role: 'button', label: 'Boundary', confidence: 0.7 })
    expect(cache.get('boundary')).not.toBeNull()
  })

  it('max entries eviction — LRU evicted when full', () => {
    const small = new ResolutionCache({ maxEntries: 3, ttl: 60000 })

    // Insert three entries with distinct timestamps by manipulating createdAt after insertion
    small.set('a', 'e1', { role: 'button', label: 'A', confidence: 0.9 })
    small.set('b', 'e2', { role: 'button', label: 'B', confidence: 0.9 })
    small.set('c', 'e3', { role: 'button', label: 'C', confidence: 0.9 })

    // Backdate 'c' so it looks like the oldest (least recently used)
    const internalCache = (small as unknown as { cache: Map<string, { createdAt: number; lastHit: number }> }).cache
    internalCache.get('c')!.createdAt = 1000   // very old
    internalCache.get('c')!.lastHit = 0
    internalCache.get('a')!.createdAt = Date.now() - 100
    internalCache.get('b')!.createdAt = Date.now() - 50

    // Adding 'd' should evict 'c' (least recently used)
    small.set('d', 'e4', { role: 'button', label: 'D', confidence: 0.9 })

    expect(small.get('c')).toBeNull()
    expect(small.get('a')).not.toBeNull()
    expect(small.get('b')).not.toBeNull()
    expect(small.get('d')).not.toBeNull()
  })

  it('clear removes all entries', () => {
    cache.set('one', 'e1', { role: 'button', label: 'One', confidence: 0.8 })
    cache.set('two', 'e2', { role: 'button', label: 'Two', confidence: 0.8 })
    cache.clear()
    expect(cache.get('one')).toBeNull()
    expect(cache.get('two')).toBeNull()
    expect(cache.stats().entries).toBe(0)
  })

  it('case-insensitive key normalization', () => {
    cache.set('Click Login Button', 'e5', { role: 'button', label: 'Log In', confidence: 0.9 })
    expect(cache.get('click login button')).not.toBeNull()
    expect(cache.get('CLICK LOGIN BUTTON')).not.toBeNull()
    expect(cache.get('  Click Login Button  ')).not.toBeNull()
  })

  it('hit counting increments on each get', () => {
    cache.set('search', 'e3', { role: 'textfield', label: 'Search', confidence: 0.85 })
    cache.get('search')
    cache.get('search')
    cache.get('search')
    const result = cache.get('search')
    expect(result!.hits).toBe(4)
  })

  it('stats reporting — entries, totalHits, avgConfidence', () => {
    cache.set('a', 'e1', { role: 'button', label: 'A', confidence: 0.8 })
    cache.set('b', 'e2', { role: 'button', label: 'B', confidence: 0.9 })
    cache.get('a')
    cache.get('b')
    cache.get('b')

    const stats = cache.stats()
    expect(stats.entries).toBe(2)
    expect(stats.totalHits).toBe(3)
    expect(stats.avgConfidence).toBeCloseTo(0.85, 5)
  })

  it('stats returns zeros when cache is empty', () => {
    const stats = cache.stats()
    expect(stats.entries).toBe(0)
    expect(stats.totalHits).toBe(0)
    expect(stats.avgConfidence).toBe(0)
  })

  it('invalidate removes a single entry', () => {
    cache.set('keep', 'e1', { role: 'button', label: 'Keep', confidence: 0.9 })
    cache.set('remove', 'e2', { role: 'button', label: 'Remove', confidence: 0.9 })
    cache.invalidate('remove')
    expect(cache.get('remove')).toBeNull()
    expect(cache.get('keep')).not.toBeNull()
  })
})
