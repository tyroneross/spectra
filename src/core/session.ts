import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Session, Step, Action, Snapshot, DriverTarget, Platform } from './types.js'
import { getStoragePath } from './storage.js'

export interface CreateSessionOptions {
  name?: string
  platform: Platform
  target: DriverTarget
}

export interface AddStepOptions {
  action: Action
  snapshotBefore: Snapshot
  snapshotAfter: Snapshot
  screenshot: Buffer
  success: boolean
  error?: string
  duration: number
}

export class SessionManager {
  private sessions = new Map<string, Session>()
  private basePath: string

  constructor(cwd?: string) {
    this.basePath = join(getStoragePath(cwd), 'sessions')
  }

  async create(options: CreateSessionOptions): Promise<Session> {
    const id = randomUUID().slice(0, 8)
    const name = options.name ?? this.generateName(options.target)
    const now = Date.now()

    const session: Session = {
      id,
      name,
      platform: options.platform,
      target: options.target,
      steps: [],
      createdAt: now,
      updatedAt: now,
    }

    // Create session directory
    const dir = this.sessionDir(id)
    await mkdir(join(dir, 'snapshots'), { recursive: true })

    this.sessions.set(id, session)
    await this.persist(session)
    return session
  }

  async addStep(sessionId: string, options: AddStepOptions): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const index = session.steps.length
    const pad = String(index).padStart(3, '0')
    const dir = this.sessionDir(sessionId)

    // Persist snapshot files
    const beforePath = `snapshots/step-${pad}-before.json`
    const afterPath = `snapshots/step-${pad}-after.json`
    const screenshotPath = `step-${pad}.png`

    await writeFile(join(dir, beforePath), JSON.stringify(options.snapshotBefore))
    await writeFile(join(dir, afterPath), JSON.stringify(options.snapshotAfter))
    await writeFile(join(dir, screenshotPath), options.screenshot)

    const step: Step = {
      index,
      action: options.action,
      snapshotBefore: beforePath,
      snapshotAfter: afterPath,
      screenshotPath,
      success: options.success,
      error: options.error,
      timestamp: Date.now(),
      duration: options.duration,
    }

    session.steps.push(step)
    session.updatedAt = Date.now()
    await this.persist(session)
  }

  get(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null
  }

  list(): Session[] {
    return [...this.sessions.values()]
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.updatedAt = Date.now()
      await this.persist(session)
      this.sessions.delete(sessionId)
    }
  }

  async closeAll(): Promise<void> {
    for (const id of this.sessions.keys()) {
      await this.close(id)
    }
  }

  private sessionDir(sessionId: string): string {
    return join(this.basePath, sessionId)
  }

  private async persist(session: Session): Promise<void> {
    const dir = this.sessionDir(session.id)
    await writeFile(join(dir, 'session.json'), JSON.stringify(session, null, 2))
  }

  private generateName(target: DriverTarget): string {
    if (target.url) {
      try {
        const url = new URL(target.url)
        return `${url.hostname}${url.pathname}`.replace(/\/$/, '').replace(/\//g, '-')
      } catch {
        return `session-${Date.now()}`
      }
    }
    if (target.appName) return target.appName.toLowerCase().replace(/\s+/g, '-')
    return `session-${Date.now()}`
  }
}
