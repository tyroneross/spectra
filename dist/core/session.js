import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getStoragePath } from './storage.js';
export class SessionManager {
    sessions = new Map();
    runs = new Map();
    basePath;
    constructor(cwd) {
        this.basePath = join(getStoragePath(cwd), 'sessions');
    }
    async create(options) {
        const id = randomUUID().slice(0, 8);
        const name = options.name ?? this.generateName(options.target);
        const now = Date.now();
        // When repoPath is supplied, anchor storage under it; this is what the
        // SwiftUI app passes on every spectra_connect so artifacts land in the
        // repo's .spectra/ instead of the daemon's CWD ($HOME under launchd).
        const storageRoot = options.repoPath
            ? join(getStoragePath(options.repoPath), 'sessions', id)
            : join(this.basePath, id);
        const session = {
            id,
            name,
            platform: options.platform,
            target: options.target,
            steps: [],
            createdAt: now,
            updatedAt: now,
            storageRoot,
        };
        const run = this.createRunManifest(session, now);
        // Create session directory (always under storageRoot now)
        await mkdir(join(storageRoot, 'snapshots'), { recursive: true });
        this.sessions.set(id, session);
        this.runs.set(id, run);
        await this.persist(session);
        await this.persistRun(id);
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
            decisionId: options.decisionId,
        };
        session.steps.push(step);
        session.updatedAt = Date.now();
        await this.addRunAction(sessionId, step, {
            tool: options.tool,
            plannerSource: options.plannerSource,
        });
        await this.persist(session);
        return step;
    }
    async addDecision(sessionId, options) {
        const decision = {
            id: randomUUID().slice(0, 8),
            timestamp: Date.now(),
            ...options,
        };
        await this.updateRun(sessionId, (run) => {
            run.decisions.push(decision);
            run.events.push({
                id: randomUUID().slice(0, 8),
                timestamp: decision.timestamp,
                type: 'decision.recorded',
                summary: decision.intent
                    ? `${decision.outcome}: ${decision.intent}`
                    : `${decision.outcome}: ${decision.tool}`,
                data: { decisionId: decision.id, outcome: decision.outcome },
            });
            if (decision.outcome === 'failed')
                run.stats.errors += 1;
        });
        return decision;
    }
    async addArtifact(sessionId, options) {
        const artifact = {
            id: randomUUID().slice(0, 8),
            createdAt: Date.now(),
            ...options,
        };
        await this.updateRun(sessionId, (run) => {
            run.artifacts.push(artifact);
            if (artifact.type === 'screenshot')
                run.stats.screenshots += 1;
            if (artifact.type === 'video')
                run.stats.videos += 1;
            run.events.push({
                id: randomUUID().slice(0, 8),
                timestamp: artifact.createdAt,
                type: 'artifact.added',
                summary: `${artifact.type}: ${artifact.path}`,
                data: { artifactId: artifact.id, path: artifact.path, type: artifact.type },
            });
        });
        return artifact;
    }
    async setRecordingStatus(sessionId, update) {
        let recording = null;
        await this.updateRun(sessionId, (run) => {
            run.recording = {
                ...run.recording,
                ...update,
            };
            recording = run.recording;
            if (update.state === 'failed')
                run.stats.errors += 1;
            run.events.push({
                id: randomUUID().slice(0, 8),
                timestamp: Date.now(),
                type: 'recording.status',
                summary: `recording ${update.state}`,
                data: { ...update },
            });
        });
        return recording;
    }
    get(sessionId) {
        return this.sessions.get(sessionId) ?? null;
    }
    getRun(sessionId) {
        return this.runs.get(sessionId) ?? null;
    }
    list() {
        return [...this.sessions.values()];
    }
    async close(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.updatedAt = Date.now();
            session.closedAt = Date.now();
            const closedAt = session.closedAt;
            await this.updateRun(sessionId, (run) => {
                run.status = 'closed';
                run.closedAt = closedAt;
                run.events.push({
                    id: randomUUID().slice(0, 8),
                    timestamp: closedAt,
                    type: 'session.closed',
                    summary: `session closed: ${sessionId}`,
                });
            });
            await this.persist(session);
            this.sessions.delete(sessionId);
            this.runs.delete(sessionId);
        }
    }
    async closeAll() {
        for (const id of this.sessions.keys()) {
            await this.close(id);
        }
    }
    /**
     * Returns the absolute path to the session directory. Prefers the per-session
     * `storageRoot` recorded at creation time (set when `repoPath` was supplied);
     * falls back to the manager-level `basePath` for legacy sessions.
     */
    sessionDir(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session?.storageRoot)
            return session.storageRoot;
        return join(this.basePath, sessionId);
    }
    async persist(session) {
        const dir = this.sessionDir(session.id);
        await writeFile(join(dir, 'session.json'), JSON.stringify(session, null, 2));
    }
    async persistRun(sessionId) {
        const run = this.runs.get(sessionId);
        if (!run)
            return;
        const dir = this.sessionDir(sessionId);
        await writeFile(join(dir, 'run.json'), JSON.stringify(run, null, 2));
    }
    createRunManifest(session, now) {
        return {
            schemaVersion: 1,
            runId: session.id,
            sessionId: session.id,
            name: session.name,
            platform: session.platform,
            target: session.target,
            planner: {
                source: 'host-agent',
                note: 'Host-routed by default; standalone planning remains fallback-only.',
            },
            status: 'active',
            recording: { state: 'idle' },
            stats: {
                steps: 0,
                screenshots: 0,
                videos: 0,
                errors: 0,
            },
            decisions: [],
            actions: [],
            artifacts: [],
            events: [{
                    id: randomUUID().slice(0, 8),
                    timestamp: now,
                    type: 'session.created',
                    summary: `session created: ${session.name}`,
                }],
            createdAt: now,
            updatedAt: now,
        };
    }
    async updateRun(sessionId, update) {
        const run = this.ensureRun(sessionId);
        update(run);
        run.stats.steps = run.actions.length;
        run.updatedAt = Date.now();
        await this.persistRun(sessionId);
    }
    ensureRun(sessionId) {
        let run = this.runs.get(sessionId);
        if (run)
            return run;
        const session = this.sessions.get(sessionId);
        if (!session)
            throw new Error(`Session ${sessionId} not found`);
        run = this.createRunManifest(session, session.createdAt);
        this.runs.set(sessionId, run);
        return run;
    }
    async addRunAction(sessionId, step, context) {
        const action = {
            stepIndex: step.index,
            timestamp: step.timestamp,
            tool: context.tool,
            plannerSource: context.plannerSource,
            intent: step.intent,
            action: step.action,
            snapshotBefore: step.snapshotBefore,
            snapshotAfter: step.snapshotAfter,
            screenshotPath: step.screenshotPath,
            success: step.success,
            error: step.error,
            duration: step.duration,
            decisionId: step.decisionId,
        };
        await this.updateRun(sessionId, (run) => {
            run.actions.push(action);
            if (!step.success)
                run.stats.errors += 1;
            run.artifacts.push({
                id: randomUUID().slice(0, 8),
                type: 'screenshot',
                path: step.screenshotPath,
                format: 'png',
                label: step.intent,
                createdAt: step.timestamp,
                stepIndex: step.index,
            });
            run.stats.screenshots += 1;
            run.events.push({
                id: randomUUID().slice(0, 8),
                timestamp: step.timestamp,
                type: 'action.completed',
                summary: `${step.success ? 'success' : 'failed'}: ${step.action.type} ${step.action.elementId}`,
                data: {
                    stepIndex: step.index,
                    action: step.action,
                    decisionId: step.decisionId,
                    error: step.error,
                },
            });
        });
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