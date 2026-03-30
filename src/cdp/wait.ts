import type { Element } from '../core/types.js'
import type { CdpConnection } from './connection.js'

export interface WaitOptions {
  interval?: number     // Polling interval in ms (default: 100)
  stableTime?: number   // How long fingerprint must stay unchanged (default: 300)
  timeout?: number      // Max wait time in ms (default: 10000)
}

type SnapshotFn = () => Promise<Element[]>

export function buildFingerprint(elements: Element[]): string {
  return elements
    .filter((e) => e.actions.length > 0)
    .map((e) => `${e.role}:${e.label}:${e.enabled}`)
    .sort()
    .join('|')
}

/**
 * Wait for a specific CDP event.
 */
export async function waitForEvent(
  conn: CdpConnection,
  eventName: string,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 10000
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.off(eventName, handler)
      reject(new Error(`Timed out waiting for ${eventName} after ${timeout}ms`))
    }, timeout)

    const handler = () => {
      clearTimeout(timer)
      conn.off(eventName, handler)
      resolve()
    }
    conn.on(eventName, handler)
  })
}

/**
 * Hybrid wait — event notification + stability check.
 * Subscribes to AX events, then confirms with fingerprint stability.
 */
export async function waitForStable(
  conn: CdpConnection,
  getSnapshot: () => Promise<Element[]>,
  options?: WaitOptions & { eventName?: string },
): Promise<{ elements: Element[]; timedOut: boolean }> {
  const eventName = options?.eventName ?? 'Accessibility.nodesUpdated'
  const timeout = options?.timeout ?? 10000
  const stableTime = options?.stableTime ?? 300
  const deadline = Date.now() + timeout

  let changed = false
  const handler = () => { changed = true }
  conn.on(eventName, handler)

  let elements = await getSnapshot()
  let lastFingerprint = buildFingerprint(elements)
  let stableSince = Date.now()

  try {
    while (Date.now() < deadline) {
      if (changed) {
        changed = false
        elements = await getSnapshot()
        const fingerprint = buildFingerprint(elements)
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint
          stableSince = Date.now()
        }
      }
      if (Date.now() - stableSince >= stableTime) {
        return { elements, timedOut: false }
      }
      await new Promise(r => setTimeout(r, 50))
    }
    elements = await getSnapshot()
    return { elements, timedOut: true }
  } finally {
    conn.off(eventName, handler)
  }
}

export async function waitForStableTree(
  getSnapshot: SnapshotFn,
  options?: WaitOptions,
): Promise<{ elements: Element[]; timedOut: boolean }> {
  const interval = options?.interval ?? 100
  const stableTime = options?.stableTime ?? 300
  const timeout = options?.timeout ?? 10000

  let lastFingerprint = ''
  let stableSince = Date.now()
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const elements = await getSnapshot()
    const fingerprint = buildFingerprint(elements)

    if (fingerprint === lastFingerprint) {
      if (Date.now() - stableSince >= stableTime) {
        return { elements, timedOut: false }
      }
    } else {
      lastFingerprint = fingerprint
      stableSince = Date.now()
    }

    await new Promise((r) => setTimeout(r, interval))
  }

  // Timed out — return last snapshot
  const elements = await getSnapshot()
  return { elements, timedOut: true }
}
