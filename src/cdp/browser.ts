import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CHROME_PATHS = [
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Linux / WSL
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
]

export function findChrome(): string | null {
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

export interface BrowserOptions {
  debuggerTimeoutMs?: number // default: 15000; isolated renderers may allow cold startup
  headless?: boolean    // default: true
  port?: number         // default: random ephemeral port
  userDataDir?: string  // default: ~/.spectra/chromium-profile/
}

function randomPort(): number {
  return 49152 + Math.floor(Math.random() * (65535 - 49152))
}

export class BrowserManager {
  private process: ChildProcess | null = null
  private port = 0
  private closed: Promise<void> = Promise.resolve()
  private exited = false
  private spawnError: Error | undefined

  async launch(options: BrowserOptions = {}): Promise<string> {
    const headless = options.headless ?? true
    this.port = options.port ?? randomPort()
    const userDataDir = options.userDataDir ?? join(homedir(), '.spectra', 'chromium-profile')

    const chromePath = findChrome()
    if (!chromePath) {
      throw new Error(
        'Chrome not found. Install Google Chrome or set a custom path.\n'
        + `Checked: ${CHROME_PATHS.join(', ')}`
      )
    }

    await mkdir(userDataDir, { recursive: true })
    if (this.port === 0) await rm(join(userDataDir, 'DevToolsActivePort'), { force: true })

    const args = [
      `--remote-debugging-port=${this.port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      // GUARDRAIL: never touch the macOS login keychain. Without these, Chrome
      // tries to store its "Safe Storage" key in the login keychain on launch,
      // which pops a blocking "Keychain Not Found — store Chrome / Reset To
      // Defaults" dialog for every automation launch. `basic` uses an in-profile
      // plaintext store; `--use-mock-keychain` forces a mock on macOS. Automation
      // Chrome holds no real secrets, so this is safe and required.
      '--password-store=basic',
      '--use-mock-keychain',
    ]
    if (headless) {
      args.push('--headless=new')
    }

    this.exited = false
    this.spawnError = undefined
    this.process = spawn(chromePath, args, { stdio: 'pipe' })
    this.closed = new Promise(resolve => this.process!.once('close', () => { this.exited = true; resolve() }))
    this.process.stdout?.on('data', () => {})
    this.process.stderr?.on('data', () => {})

    this.process.on('error', (err) => {
      this.spawnError = err
    })

    return this.waitForDebugger(options.debuggerTimeoutMs ?? 15000, this.port === 0 ? userDataDir : undefined)
  }

  private async waitForDebugger(timeoutMs: number, profile?: string): Promise<string> {
    const maxAttempts = Math.ceil(timeoutMs / 100)
    for (let i = 0; i < maxAttempts; i++) {
      if (this.exited || this.spawnError) throw this.spawnError ?? new Error('Chrome exited before its debugger started')
      try {
        if (profile) {
          // Port zero writes the endpoint into THIS profile, avoiding unrelated browsers.
          const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n')
          if (!/^\d+$/.test(port) || !path?.startsWith('/devtools/browser/')) throw new Error('Waiting for debugger endpoint')
          this.port = Number(port)
          return `ws://127.0.0.1:${port}${path}`
        }
        const res = await fetch(`http://127.0.0.1:${this.port}/json/version`)
        const data = (await res.json()) as { webSocketDebuggerUrl: string }
        return data.webSocketDebuggerUrl
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    throw new Error(
      `Chrome debugger did not respond within ${timeoutMs / 1000}s on port ${this.port}. `
      + 'Is another Chrome instance using this port?'
    )
  }

  async close(): Promise<void> {
    if (this.process) {
      const child = this.process
      this.process = null
      if (this.exited) return
      const timer = setTimeout(() => { child.kill('SIGKILL') }, 3000)
      child.kill()
      try { await this.closed } finally { clearTimeout(timer) }
    }
  }

  get running(): boolean {
    return this.process !== null && !this.process.killed
  }
}
