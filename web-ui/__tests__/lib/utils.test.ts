import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { relativeTime, formatBytes } from '../../lib/utils.js'

describe('relativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for timestamps under 60 seconds ago', () => {
    expect(relativeTime(Date.now() - 30_000)).toBe('just now')
    expect(relativeTime(Date.now() - 0)).toBe('just now')
    expect(relativeTime(Date.now() - 59_000)).toBe('just now')
  })

  it('returns minutes for timestamps under 1 hour ago', () => {
    expect(relativeTime(Date.now() - 60_000)).toBe('1m ago')
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe('5m ago')
    expect(relativeTime(Date.now() - 59 * 60_000)).toBe('59m ago')
  })

  it('returns hours for timestamps under 24 hours ago', () => {
    expect(relativeTime(Date.now() - 60 * 60_000)).toBe('1h ago')
    expect(relativeTime(Date.now() - 2 * 60 * 60_000)).toBe('2h ago')
    expect(relativeTime(Date.now() - 23 * 60 * 60_000)).toBe('23h ago')
  })

  it('returns days for timestamps under 7 days ago', () => {
    expect(relativeTime(Date.now() - 24 * 60 * 60_000)).toBe('1d ago')
    expect(relativeTime(Date.now() - 3 * 24 * 60 * 60_000)).toBe('3d ago')
    expect(relativeTime(Date.now() - 6 * 24 * 60 * 60_000)).toBe('6d ago')
  })

  it('returns formatted date for timestamps 7+ days ago', () => {
    // 7 days ago from 2024-06-15 = 2024-06-08
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60_000
    const result = relativeTime(sevenDaysAgo)
    // Should be a date string like "Jun 8"
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/)
  })
})

describe('formatBytes', () => {
  it('returns "0 B" for zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats bytes under 1 KB as whole bytes', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats kilobytes with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024)).toBe('10.0 KB')
  })

  it('formats megabytes with one decimal', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })

  it('formats gigabytes with one decimal', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(formatBytes(1.2 * 1024 * 1024 * 1024)).toBe('1.2 GB')
  })
})
