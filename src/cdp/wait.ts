import type { Element } from '../core/types.js'

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
