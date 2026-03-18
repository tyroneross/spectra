import { SessionManager } from '../core/session.js'
import { CdpDriver } from '../cdp/driver.js'
import type { Platform } from '../core/types.js'

export interface ToolContext {
  sessions: SessionManager
  drivers: Map<string, CdpDriver>
}

export function createContext(): ToolContext {
  return {
    sessions: new SessionManager(),
    drivers: new Map(),
  }
}

export function detectPlatform(target: string): Platform {
  if (/^https?:\/\//.test(target)) return 'web'
  if (target.startsWith('sim:')) {
    const device = target.slice(4).toLowerCase()
    if (device.includes('watch')) return 'watchos'
    return 'ios'
  }
  return 'macos'
}
