// src/mcp/context.ts
import { SessionManager } from '../core/session.js'
import type { Driver, Platform } from '../core/types.js'

export interface ToolContext {
  sessions: SessionManager
  drivers: Map<string, Driver>
}

export function createContext(): ToolContext {
  return {
    sessions: new SessionManager(),
    drivers: new Map(),
  }
}

export interface PlatformInfo {
  platform: Platform
  driverType: 'cdp' | 'native' | 'sim'
}

export function detectPlatform(target: string): PlatformInfo {
  if (/^https?:\/\//.test(target)) {
    return { platform: 'web', driverType: 'cdp' }
  }
  if (target.startsWith('sim:')) {
    const device = target.slice(4).toLowerCase()
    const platform: Platform = device.includes('watch') ? 'watchos' : 'ios'
    return { platform, driverType: 'sim' }
  }
  return { platform: 'macos', driverType: 'native' }
}
