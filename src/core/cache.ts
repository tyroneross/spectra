export interface CachedResolution {
  intent: string
  elementId: string
  role: string
  label: string
  confidence: number
  createdAt: number
  hits: number
  lastHit: number
}

export interface CacheOptions {
  maxEntries?: number    // default: 100
  ttl?: number           // default: 5 minutes
  minConfidence?: number // default: 0.7
}

export class ResolutionCache {
  private cache = new Map<string, CachedResolution>()
  private maxEntries: number
  private ttl: number
  private minConfidence: number

  constructor(options: CacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 100
    this.ttl = options.ttl ?? 5 * 60 * 1000
    this.minConfidence = options.minConfidence ?? 0.7
  }

  get(intent: string): CachedResolution | null {
    const key = this.normalizeKey(intent)
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.createdAt > this.ttl) {
      this.cache.delete(key)
      return null
    }
    entry.hits++
    entry.lastHit = Date.now()
    return entry
  }

  set(
    intent: string,
    elementId: string,
    metadata: { role: string; label: string; confidence: number },
  ): void {
    if (metadata.confidence < this.minConfidence) return
    const key = this.normalizeKey(intent)
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictOldest()
    }
    this.cache.set(key, {
      intent,
      elementId,
      role: metadata.role,
      label: metadata.label,
      confidence: metadata.confidence,
      createdAt: Date.now(),
      hits: 0,
      lastHit: 0,
    })
  }

  invalidate(intent: string): void {
    this.cache.delete(this.normalizeKey(intent))
  }

  clear(): void {
    this.cache.clear()
  }

  stats(): { entries: number; totalHits: number; avgConfidence: number } {
    let totalHits = 0
    let totalConfidence = 0
    for (const entry of this.cache.values()) {
      totalHits += entry.hits
      totalConfidence += entry.confidence
    }
    return {
      entries: this.cache.size,
      totalHits,
      avgConfidence: this.cache.size > 0 ? totalConfidence / this.cache.size : 0,
    }
  }

  private normalizeKey(intent: string): string {
    return intent.toLowerCase().trim()
  }

  private evictOldest(): void {
    let oldest: string | null = null
    let oldestTime = Infinity
    for (const [key, entry] of this.cache) {
      const lastUsed = entry.lastHit || entry.createdAt
      if (lastUsed < oldestTime) {
        oldestTime = lastUsed
        oldest = key
      }
    }
    if (oldest) this.cache.delete(oldest)
  }
}
