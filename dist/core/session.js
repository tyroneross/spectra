import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getStoragePath } from './storage.js';
export class SessionManager {
    sessions = new Map();
    basePath;
    constructor(cwd) {
        this.basePath = join(getStoragePath(cwd), 'sessions');
    }
    async create(options) {
        const id = randomUUID().slice(0, 8);
        const name = options.name ?? this.generateName(options.target);
        const now = Date.now();
        const session = {
            id,
            name,
            platform: options.platform,
            target: options.target,
            steps: [],
            createdAt: now,
            updatedAt: now,
        };
        // Create session directory
        const dir = this.sessionDir(id);
        await mkdir(join(dir, 'snapshots'), { recursive: true });
        this.sessions.set(id, session);
        await this.persist(session);
        return session;
    }
    async addStep(sessionId, options) {
        const session = this.sessions.get(sessionId);
        if (!session)
            throw new Error(`Session ${sessionId} not found`);
        const index = session.steps.length;
        const pad = String(index).padStart(3, '0');
        const dir = this.sessionDir(sessionId);
        // Persist snapshot files
        const beforePath = `snapshots/step-${pad}-before.json`;
        const afterPath = `snapshots/step-${pad}-after.json`;
        const screenshotPath = `step-${pad}.png`;
        await writeFile(join(dir, beforePath), JSON.stringify(options.snapshotBefore));
        await writeFile(join(dir, afterPath), JSON.stringify(options.snapshotAfter));
        await writeFile(join(dir, screenshotPath), options.screenshot);
        const step = {
            index,
            action: options.action,
            snapshotBefore: beforePath,
            snapshotAfter: afterPath,
            screenshotPath,
            success: options.success,
            error: options.error,
            timestamp: Date.now(),
            duration: options.duration,
            intent: options.intent,
        };
        session.steps.push(step);
        session.updatedAt = Date.now();
        await this.persist(session);
    }
    get(sessionId) {
        return this.sessions.get(sessionId) ?? null;
    }
    list() {
        return [...this.sessions.values()];
    }
    async close(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.updatedAt = Date.now();
            session.closedAt = Date.now();
            await this.persist(session);
            this.sessions.delete(sessionId);
        }
    }
    async closeAll() {
        for (const id of this.sessions.keys()) {
            await this.close(id);
        }
    }
    sessionDir(sessionId) {
        return join(this.basePath, sessionId);
    }
    async persist(session) {
        const dir = this.sessionDir(session.id);
        await writeFile(join(dir, 'session.json'), JSON.stringify(session, null, 2));
    }
    generateName(target) {
        if (target.url) {
            try {
                const url = new URL(target.url);
                return `${url.hostname}${url.pathname}`.replace(/\/$/, '').replace(/\//g, '-');
            }
            catch {
                return `session-${Date.now()}`;
            }
        }
        if (target.appName)
            return target.appName.toLowerCase().replace(/\s+/g, '-');
        return `session-${Date.now()}`;
    }
}
//# sourceMappingURL=session.js.map