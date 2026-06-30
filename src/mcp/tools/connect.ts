// src/mcp/tools/connect.ts
import type { ToolContext } from '../context.js'
import { detectPlatform } from '../context.js'
import { CdpDriver } from '../../cdp/driver.js'
import { NativeDriver } from '../../native/driver.js'
import { SimDriver } from '../../native/sim.js'
import { serializeSnapshot } from '../../core/serialize.js'
import type { Driver, DriverTarget } from '../../core/types.js'
import { launchRepo, LauncherError, type LaunchHandle } from '../../launcher/index.js'

export interface ConnectParams {
  target: string
  name?: string
  record?: boolean
  /**
   * If present, the launcher first boots a dev server / macOS app for this
   * repo, then derives the effective target from the launch result (overriding
   * `target` for web/macos kinds).
   */
  repoPath?: string
}

export interface ConnectResult {
  sessionId: string
  platform: string
  elementCount: number
  snapshot: string
  launched?: {
    kind: string
    pid?: number
    url?: string
    appName?: string
  }
}

/**
 * If launching, the resolved target overrides the user-supplied one. For web
 * we use the printed dev-server URL; for macos we use the resolved app name.
 */
function deriveTargetFromLaunch(handle: LaunchHandle): string {
  if (handle.url) return handle.url
  if (handle.appName) return handle.appName
  throw new LauncherError(
    'Launch produced no usable target',
    'Launcher returned neither a URL nor an app name.'
  )
}

export async function handleConnect(
  params: ConnectParams,
  ctx: ToolContext,
  createDriver?: () => Driver,
): Promise<ConnectResult> {
  // ─── Launch first if a repoPath was supplied ─────────────────
  let launchHandle: LaunchHandle | undefined
  let effectiveTarget = params.target
  if (params.repoPath) {
    launchHandle = await launchRepo(params.repoPath)
    effectiveTarget = deriveTargetFromLaunch(launchHandle)
  }

  const { platform, driverType } = detectPlatform(effectiveTarget)

  const driverTarget: DriverTarget = {}
  if (platform === 'web') {
    driverTarget.url = effectiveTarget
  } else if (platform === 'macos') {
    driverTarget.appName = effectiveTarget
  } else {
    driverTarget.deviceId = effectiveTarget.replace(/^sim:/, '')
  }

  const session = await ctx.sessions.create({
    name: params.name,
    platform,
    target: driverTarget,
    // C2.6: anchor storage under the supplied repo so launchd-spawned daemons
    // (CWD=$HOME) still write into <repo>/.spectra/ instead of ~/.spectra/.
    repoPath: params.repoPath,
  })

  // Stash the launch handle so close-session can tear it down. ctx.launches
  // is added in C2; defensively guard for older test-constructed contexts.
  if (launchHandle) {
    if (ctx.launches) {
      ctx.launches.set(session.id, launchHandle)
    }
    const sessObj = ctx.sessions.get(session.id)
    if (sessObj) {
      sessObj.launchedProcess = {
        pid: launchHandle.pid,
        kind: launchHandle.kind,
        killOnDisconnect: launchHandle.killOnDisconnect,
      }
    }
  }

  // Record-only macOS sessions skip the Accessibility-gated AX snapshot. Recording
  // resolves the target window AND captures it via ScreenCaptureKit (Screen Recording
  // permission) — it never touches the AX element inventory. Coupling capture to the
  // snapshot forced an Accessibility grant the recording path doesn't use (root-caused
  // 2026-06-29). With `record: true` we register the session (target.appName is already
  // set above) and return without the AX call, so startRecording works with only the
  // Screen Recording grant.
  if (params.record === true && platform === 'macos') {
    return {
      sessionId: session.id,
      platform,
      elementCount: 0,
      snapshot: '',
      launched: launchHandle ? {
        kind: launchHandle.kind,
        pid: launchHandle.pid,
        url: launchHandle.url,
        appName: launchHandle.appName,
      } : undefined,
    }
  }

  const driver = createDriver
    ? createDriver()
    : driverType === 'cdp' ? new CdpDriver()
    : driverType === 'native' ? new NativeDriver()
    : new SimDriver()

  await driver.connect(driverTarget)
  ctx.drivers.set(session.id, driver)

  const snap = await driver.snapshot()
  const serialized = serializeSnapshot(snap)

  return {
    sessionId: session.id,
    platform,
    elementCount: snap.elements.length,
    snapshot: serialized,
    launched: launchHandle ? {
      kind: launchHandle.kind,
      pid: launchHandle.pid,
      url: launchHandle.url,
      appName: launchHandle.appName,
    } : undefined,
  }
}
