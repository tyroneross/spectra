import { execFile, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { detectFfmpeg } from '../media/ffmpeg.js';
import { probeVideo } from '../media/pipeline.js';
import { createContext } from '../mcp/context.js';
import { handleAnalyze } from '../mcp/tools/analyze.js';
import { handleAct } from '../mcp/tools/act.js';
import { handleCapture } from '../mcp/tools/capture.js';
import { handleConnect } from '../mcp/tools/connect.js';
import { handleDemo } from '../mcp/tools/demo.js';
import { handleDiscover } from '../mcp/tools/discover.js';
import { handleLibrary } from '../mcp/tools/library.js';
import { handleLlmStep } from '../mcp/tools/llm-step.js';
import { handleRecord, handleReplay } from '../mcp/tools/record.js';
import { handleSession } from '../mcp/tools/session.js';
import { handleSnapshot } from '../mcp/tools/snapshot.js';
import { handleStep } from '../mcp/tools/step.js';
import { handleWalkthrough } from '../mcp/tools/walkthrough.js';
import { ensureBinary, ensureCompositeBinary, ensureScreenRecordingPreflightBinary } from '../native/compiler.js';
import { COMPOSITE_WORKER_DEFAULTS, parseLuminance, recordCompositeWithWorker, } from './composite-worker.js';
import { DaemonApiError } from './errors.js';
import { health as daemonHealth } from './health.js';
import { createKeepAwakeController } from './keep-awake.js';
const execFileAsync = promisify(execFile);
let screenCaptureKitWindowList;
export function createCoreApi(options = {}) {
    return new CoreApiImplementation(options);
}
class CoreApiImplementation {
    ctx;
    startedAt;
    daemonVersion;
    healthProbe;
    keepAwake;
    recordCompositeWorker;
    singleWindowRecordingRunner;
    windowListProvider;
    eventSink;
    recordings = new RecordingRegistry();
    constructor(options) {
        this.ctx = options.context ?? createContext();
        this.startedAt = options.startedAt ?? Date.now();
        this.daemonVersion = options.daemonVersion;
        this.healthProbe = options.healthProbe;
        this.keepAwake = options.keepAwake ?? createKeepAwakeController();
        this.recordCompositeWorker = options.recordCompositeWorker ?? recordCompositeWithWorker;
        this.singleWindowRecordingRunner = options.singleWindowRecordingRunner ?? startNativeSingleWindowRecording;
        this.windowListProvider = options.windowListProvider ?? listMacWindows;
        this.eventSink = options.eventSink;
    }
    async health(params = {}) {
        return daemonHealth(params, {
            ...this.healthProbe,
            startedAt: this.startedAt,
            daemonVersion: this.daemonVersion,
            permissionsProvider: () => this.getPermissions({}).then((r) => r.permissions),
        });
    }
    async getPermissions(params = {}) {
        return { permissions: await getPermissionStatuses(params.permissions) };
    }
    async requestPermissions(params) {
        if (params.openSettings && process.platform === 'darwin') {
            await openPermissionSettings(params.permissions).catch(() => { });
        }
        const result = await this.getPermissions({ permissions: params.permissions });
        return { ...result, requested: params.permissions };
    }
    async listWindows(params = {}) {
        const windows = await this.windowListProvider();
        const app = params.app?.toLowerCase();
        const title = params.title?.toLowerCase();
        return {
            windows: windows.filter((window) => {
                if (params.onScreenOnly !== false && !window.onScreen)
                    return false;
                if (app) {
                    const appName = window.appName.toLowerCase();
                    const bundle = window.bundleIdentifier?.toLowerCase() ?? '';
                    if (!appName.includes(app) && !bundle.includes(app))
                        return false;
                }
                if (title && !window.title.toLowerCase().includes(title))
                    return false;
                return true;
            }),
        };
    }
    async createSession(params) {
        const result = await handleConnect(params, this.ctx);
        const session = this.ctx.sessions.get(result.sessionId);
        if (session) {
            this.emit({
                type: 'session.created',
                sessionId: session.id,
                data: {
                    session: {
                        id: session.id,
                        name: session.name,
                        platform: session.platform,
                        steps: session.steps.length,
                        recordingState: this.ctx.sessions.getRun(session.id)?.recording.state ?? 'idle',
                        createdAt: new Date(session.createdAt).toISOString(),
                    },
                },
            });
        }
        return result;
    }
    async listSessions(_params = {}) {
        return {
            sessions: this.ctx.sessions.list().map((session) => ({
                id: session.id,
                name: session.name,
                platform: session.platform,
                steps: session.steps.length,
                recordingState: this.ctx.sessions.getRun(session.id)?.recording.state ?? 'idle',
                createdAt: new Date(session.createdAt).toISOString(),
            })),
        };
    }
    async getSession(params) {
        const session = this.ctx.sessions.get(params.sessionId);
        if (!session)
            throw new DaemonApiError('not_found', `Session ${params.sessionId} not found`, { status: 404 });
        return {
            session,
            run: this.ctx.sessions.getRun(params.sessionId),
        };
    }
    async getRun(params) {
        const run = this.ctx.sessions.getRun(params.sessionId);
        if (!run)
            throw new DaemonApiError('not_found', `Run for session ${params.sessionId} not found`, { status: 404 });
        return { run: run };
    }
    async closeSession(params) {
        return handleSession({ action: 'close', sessionId: params.sessionId }, this.ctx);
    }
    async closeAllSessions() {
        return handleSession({ action: 'close_all' }, this.ctx);
    }
    async recordLlmUsage(params) {
        return handleSession({ action: 'record_llm_usage', sessionId: params.sessionId, usage: params.usage }, this.ctx);
    }
    async snapshot(params) {
        return handleSnapshot(params, this.ctx);
    }
    async observe(params) {
        const snapshot = await this.snapshot(params);
        const session = this.ctx.sessions.get(params.sessionId);
        const run = this.ctx.sessions.getRun(params.sessionId);
        return {
            ...snapshot,
            sessionId: params.sessionId,
            platform: session?.platform,
            recording: run?.recording,
            analysis: params.analyze ? await this.analyze(params) : undefined,
        };
    }
    async act(params) {
        return handleAct(params, this.ctx);
    }
    async step(params) {
        return handleStep(params, this.ctx);
    }
    async llmStep(params) {
        return handleLlmStep(params, this.ctx);
    }
    async walkthrough(params) {
        return handleWalkthrough(params, this.ctx);
    }
    async screenshot(params) {
        return handleCapture({ ...params, type: 'screenshot' }, this.ctx);
    }
    async startRecording(params) {
        const session = this.ctx.sessions.get(params.sessionId);
        if (!session)
            throw new DaemonApiError('not_found', `Session ${params.sessionId} not found`, { status: 404 });
        if (session.platform !== 'macos' || !session.target.appName) {
            throw new DaemonApiError('recording_failed', 'startRecording currently requires a macOS session with an app target.', { status: 400, retryable: false });
        }
        if (this.recordings.forSession(params.sessionId)) {
            throw new DaemonApiError('conflict', `Session ${params.sessionId} already has an active recording.`, { status: 409, retryable: false });
        }
        const target = await this.resolveRecordingTarget(session.target.appName);
        const recordingId = `recording-${randomUUID().slice(0, 8)}`;
        const sessionDir = this.ctx.sessions.sessionDir(params.sessionId);
        await mkdir(sessionDir, { recursive: true });
        const outPath = join(sessionDir, `${recordingId}.mp4`);
        const startedAt = Date.now();
        const fps = params.fps ?? 60;
        const codec = params.codec ?? 'h264';
        const bitrate = params.bitrate ?? '8M';
        await this.keepAwake.recordingStarted(recordingId);
        let handle;
        try {
            handle = await this.singleWindowRecordingRunner({
                recordingId,
                sessionId: params.sessionId,
                app: session.target.appName,
                outPath,
                fps,
                codec,
                bitrate,
                maxDurationSeconds: 300,
            });
        }
        catch (error) {
            await this.keepAwake.recordingStopped(recordingId).catch(() => { });
            throw new DaemonApiError('recording_failed', `startRecording failed: ${error instanceof Error ? error.message : String(error)}`, {
                status: 500,
                hint: 'Verify the target window is visible/on-screen and Screen Recording permission is granted to the signed Spectra daemon helper.',
                retryable: false,
                cause: error,
            });
        }
        this.recordings.add({
            recordingId,
            sessionId: params.sessionId,
            target,
            startedAt,
            outPath,
            preset: params.preset,
            fps,
            codec,
            bitrate,
            handle,
        });
        const recording = await this.ctx.sessions.setRecordingStatus(params.sessionId, {
            state: 'recording',
            recordingId,
            preset: params.preset,
            startedAt,
            rawPath: outPath,
            fps,
            codec,
            bitrate,
            width: handle.started.width,
            height: handle.started.height,
            source: `${target.appName}${target.title ? `: ${target.title}` : ''}`,
            sourceVerified: true,
        });
        this.emitRecordingStatus(params.sessionId, recording);
        return {
            recordingId,
            preset: params.preset,
            startedAt,
            fps,
            codec,
            bitrate,
        };
    }
    async stopRecording(params) {
        const session = this.ctx.sessions.get(params.sessionId);
        if (!session)
            throw new DaemonApiError('not_found', `Session ${params.sessionId} not found`, { status: 404 });
        const active = this.recordings.forSession(params.sessionId);
        if (!active) {
            return {
                preset: params.preset,
                alreadyStopped: true,
                error: `No active recording for session ${params.sessionId}`,
            };
        }
        this.recordings.remove(active.recordingId);
        let stopped;
        try {
            await this.ctx.sessions.setRecordingStatus(params.sessionId, {
                state: 'encoding',
                recordingId: active.recordingId,
                preset: active.preset,
                startedAt: active.startedAt,
                rawPath: active.outPath,
                fps: active.fps,
                codec: active.codec,
                bitrate: active.bitrate,
            });
            stopped = await active.handle.stop();
        }
        catch (error) {
            await this.keepAwake.recordingStopped(active.recordingId).catch(() => { });
            await active.handle.abort().catch(() => { });
            const failed = await this.ctx.sessions.setRecordingStatus(params.sessionId, {
                state: 'failed',
                recordingId: active.recordingId,
                preset: active.preset,
                startedAt: active.startedAt,
                stoppedAt: Date.now(),
                rawPath: active.outPath,
                error: error instanceof Error ? error.message : String(error),
            }).catch(() => { });
            if (failed)
                this.emitRecordingStatus(params.sessionId, failed);
            throw new DaemonApiError('recording_failed', `stopRecording failed: ${error instanceof Error ? error.message : String(error)}`, { status: 500, retryable: false, cause: error });
        }
        await this.keepAwake.recordingStopped(active.recordingId).catch(() => { });
        const stoppedAt = Date.now();
        const path = stopped.path || active.outPath;
        const file = await stat(path).catch(() => undefined);
        const probed = await probeVideo(path).catch(() => undefined);
        const blackFrameGuard = probeRecordingBlackFrames(path);
        const warnings = [];
        if (blackFrameGuard.allBlack) {
            warnings.push(`Output appears all-black (mean luminance ${blackFrameGuard.meanLuma?.toFixed(1)} < `
                + `${COMPOSITE_WORKER_DEFAULTS.blackThreshold} across ${blackFrameGuard.sampleCount} sampled frames).`);
        }
        else if (blackFrameGuard.skipped) {
            warnings.push('Black-frame guard skipped; ffmpeg was unavailable or no luminance samples were produced.');
        }
        const durationMs = stopped.durationMs ?? probed?.durationMs ?? Math.max(0, stoppedAt - active.startedAt);
        const sizeBytes = stopped.sizeBytes ?? file?.size;
        const saved = await this.ctx.sessions.setRecordingStatus(params.sessionId, {
            state: 'saved',
            recordingId: active.recordingId,
            preset: active.preset,
            startedAt: active.startedAt,
            stoppedAt,
            rawPath: active.outPath,
            path,
            durationMs,
            sizeBytes,
            codec: stopped.codec ?? probed?.codec ?? active.codec,
            fps: stopped.fps ?? probed?.fps ?? active.fps,
            width: stopped.width ?? probed?.width,
            height: stopped.height ?? probed?.height,
            bitrate: active.bitrate,
            droppedFrames: stopped.droppedFrames,
            source: `${active.target.appName}${active.target.title ? `: ${active.target.title}` : ''}`,
            sourceVerified: true,
        });
        this.emitRecordingStatus(params.sessionId, saved);
        const artifact = await this.ctx.sessions.addArtifact(params.sessionId, {
            type: 'video',
            path,
            format: stopped.format ?? 'mp4',
            label: 'Window recording',
            sizeBytes,
            metadata: {
                recordingId: active.recordingId,
                appName: active.target.appName,
                title: active.target.title,
                blackFrameMeanLuma: blackFrameGuard.meanLuma,
                blackFrameAllBlack: blackFrameGuard.allBlack,
                blackFrameSampleCount: blackFrameGuard.sampleCount,
                warnings,
            },
        });
        this.emitArtifactAdded(params.sessionId, artifact);
        return {
            recordingId: active.recordingId,
            preset: active.preset,
            path,
            format: stopped.format ?? 'mp4',
            durationMs,
            sizeBytes,
            codec: stopped.codec ?? probed?.codec ?? active.codec,
            fps: stopped.fps ?? probed?.fps ?? active.fps,
            width: stopped.width ?? probed?.width,
            height: stopped.height ?? probed?.height,
            droppedFrames: stopped.droppedFrames,
            alreadyStopped: false,
        };
    }
    async recordComposite(params) {
        const recordingId = `composite-${randomUUID().slice(0, 8)}`;
        const startedAt = Date.now();
        const compositeSession = params.sessionId && this.ctx.sessions.get(params.sessionId)
            ? params.sessionId
            : undefined;
        await this.keepAwake.recordingStarted(recordingId);
        try {
            if (compositeSession) {
                const recording = await this.ctx.sessions.setRecordingStatus(compositeSession, {
                    state: 'recording',
                    recordingId,
                    startedAt,
                    rawPath: params.outPath,
                    fps: params.fps,
                    source: `${params.appA} + ${params.appB}`,
                    sourceVerified: true,
                });
                this.emitRecordingStatus(compositeSession, recording);
            }
            const result = await this.recordCompositeWorker(params);
            const artifact = result.ok && result.output
                ? await this.addCompositeArtifact(params, result, recordingId)
                : undefined;
            if (compositeSession) {
                const recording = await this.ctx.sessions.setRecordingStatus(compositeSession, {
                    state: result.ok ? 'saved' : 'failed',
                    recordingId,
                    startedAt,
                    stoppedAt: Date.now(),
                    rawPath: params.outPath,
                    path: result.output,
                    durationMs: params.durationSeconds !== undefined ? Math.round(params.durationSeconds * 1000) : undefined,
                    fps: params.fps,
                    source: `${params.appA} + ${params.appB}`,
                    sourceVerified: true,
                    error: result.ok ? undefined : result.error,
                });
                this.emitRecordingStatus(compositeSession, recording);
            }
            if (artifact && params.sessionId)
                this.emitArtifactAdded(params.sessionId, artifact);
            return artifact ? { ...result, artifactId: artifact.id } : result;
        }
        catch (error) {
            if (compositeSession) {
                const recording = await this.ctx.sessions.setRecordingStatus(compositeSession, {
                    state: 'failed',
                    recordingId,
                    startedAt,
                    stoppedAt: Date.now(),
                    rawPath: params.outPath,
                    error: error instanceof Error ? error.message : String(error),
                }).catch(() => undefined);
                if (recording)
                    this.emitRecordingStatus(compositeSession, recording);
            }
            throw new DaemonApiError('recording_failed', `recordComposite failed: ${error instanceof Error ? error.message : String(error)}`, {
                status: 500,
                hint: 'Verify the daemon is running in a GUI/Aqua session with Screen Recording permission, target windows are visible, ffmpeg is installed, and the Swift composite worker builds.',
                retryable: false,
                cause: error,
            });
        }
        finally {
            await this.keepAwake.recordingStopped(recordingId).catch(() => { });
        }
    }
    async analyze(params) {
        return handleAnalyze(params, this.ctx);
    }
    async discover(params) {
        return handleDiscover(params, this.ctx);
    }
    async recordTerminal(params) {
        return handleRecord(params);
    }
    async replayTerminal(params) {
        return handleReplay(params);
    }
    async library(params) {
        return handleLibrary(params);
    }
    async demo(params) {
        if (params.action === 'record-composite') {
            const { action: _action, ...recordParams } = params;
            return this.recordComposite(recordParams);
        }
        return handleDemo(params, this.ctx);
    }
    async autoRampDemo(params) {
        return handleDemo({ ...params, action: 'auto-ramp' }, this.ctx);
    }
    async close() {
        await Promise.all(this.recordings.list().map(async (recording) => {
            this.recordings.remove(recording.recordingId);
            await recording.handle.abort().catch(() => { });
            await this.keepAwake.recordingStopped(recording.recordingId).catch(() => { });
            const status = await this.ctx.sessions.setRecordingStatus(recording.sessionId, {
                state: 'aborted',
                recordingId: recording.recordingId,
                preset: recording.preset,
                startedAt: recording.startedAt,
                stoppedAt: Date.now(),
                rawPath: recording.outPath,
            }).catch(() => { });
            if (status)
                this.emitRecordingStatus(recording.sessionId, status);
        }));
        await this.keepAwake.close();
    }
    async addCompositeArtifact(params, result, recordingId) {
        if (!params.sessionId || !this.ctx.sessions.get(params.sessionId))
            return undefined;
        const metadata = {
            recordingId,
            appA: params.appA,
            appB: params.appB,
            blackFrameMeanLuma: result.blackFrameGuard.meanLuma,
            blackFrameAllBlack: result.blackFrameGuard.allBlack,
            blackFrameSampleCount: result.blackFrameGuard.sampleCount,
            warnings: result.warnings,
        };
        if (params.durationSeconds !== undefined)
            metadata.durationSeconds = params.durationSeconds;
        if (params.fps !== undefined)
            metadata.fps = params.fps;
        const artifact = await this.ctx.sessions.addArtifact(params.sessionId, {
            type: 'video',
            path: result.output,
            format: 'mp4',
            label: 'Composite recording',
            metadata,
        });
        return artifact;
    }
    emit(event) {
        this.eventSink?.(event);
    }
    emitRecordingStatus(sessionId, recording) {
        this.emit({
            type: 'recording.status',
            sessionId,
            data: { ...recording, sessionId },
        });
    }
    emitArtifactAdded(sessionId, artifact) {
        this.emit({
            type: 'artifact.added',
            sessionId,
            data: artifact,
        });
    }
    async resolveRecordingTarget(app) {
        const appNeedle = app.toLowerCase();
        const windows = await this.windowListProvider();
        const candidates = windows.filter((window) => {
            const appName = window.appName.toLowerCase();
            const bundle = window.bundleIdentifier?.toLowerCase() ?? '';
            return window.onScreen
                && window.layer === 0
                && window.width >= 100
                && window.height >= 100
                && (appName.includes(appNeedle) || bundle.includes(appNeedle));
        });
        if (candidates.length === 0) {
            throw new DaemonApiError('recording_failed', `No on-screen ScreenCaptureKit window found for app ${app}`, { status: 404, retryable: false });
        }
        return candidates.sort((left, right) => {
            const leftTitled = left.title.length > 0;
            const rightTitled = right.title.length > 0;
            if (leftTitled !== rightTitled)
                return leftTitled ? -1 : 1;
            if (left.layer !== right.layer)
                return left.layer - right.layer;
            return (right.width * right.height) - (left.width * left.height);
        })[0];
    }
}
class RecordingRegistry {
    byId = new Map();
    bySession = new Map();
    add(recording) {
        if (this.byId.has(recording.recordingId)) {
            throw new Error(`Duplicate recordingId ${recording.recordingId}`);
        }
        if (this.bySession.has(recording.sessionId)) {
            throw new Error(`Session ${recording.sessionId} already has an active recording`);
        }
        this.byId.set(recording.recordingId, recording);
        this.bySession.set(recording.sessionId, recording.recordingId);
    }
    forSession(sessionId) {
        const recordingId = this.bySession.get(sessionId);
        return recordingId ? this.byId.get(recordingId) : undefined;
    }
    remove(recordingId) {
        const recording = this.byId.get(recordingId);
        if (!recording)
            return undefined;
        this.byId.delete(recordingId);
        this.bySession.delete(recording.sessionId);
        return recording;
    }
    list() {
        return [...this.byId.values()];
    }
}
class NativeRecordingProcess {
    child;
    input;
    pid;
    started;
    readline;
    stderrChunks = [];
    pending = new Map();
    nextId = 0;
    closed = false;
    constructor(child, input) {
        this.child = child;
        this.input = input;
        this.pid = child.pid;
        this.readline = createInterface({ input: child.stdout });
        this.readline.on('line', (line) => this.handleLine(line));
        child.stderr.on('data', (chunk) => this.stderrChunks.push(Buffer.from(chunk)));
        child.on('error', (error) => this.rejectAll(error));
        child.on('close', (code, signal) => {
            this.closed = true;
            this.rejectAll(new Error(`spectra-native recording process exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`));
            this.readline.close();
        });
    }
    async start() {
        this.started = await this.send('startRecording', {
            recordingId: this.input.recordingId,
            sessionId: this.input.sessionId,
            app: this.input.app,
            outPath: this.input.outPath,
            fps: this.input.fps,
            codec: this.input.codec,
            bitrate: this.input.bitrate,
            maxDuration: this.input.maxDurationSeconds,
        }, 15_000);
        return this;
    }
    async stop() {
        const result = await this.send('stopRecording', {
            recordingId: this.input.recordingId,
            sessionId: this.input.sessionId,
        }, 45_000);
        await this.quit();
        return result;
    }
    async abort() {
        if (this.closed)
            return;
        await this.quit().catch(() => { });
        if (!this.closed) {
            this.child.kill('SIGTERM');
            await waitForChildExit(this.child, 2_000).catch(() => {
                if (!this.closed)
                    this.child.kill('SIGKILL');
            });
        }
    }
    async quit() {
        if (this.closed)
            return;
        await this.send('quit', {}, 1_000).catch(() => { });
        await waitForChildExit(this.child, 2_000).catch(() => { });
    }
    send(method, params, timeoutMs) {
        if (this.closed) {
            return Promise.reject(new Error('spectra-native recording process is closed'));
        }
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Native recording request '${method}' timed out after ${timeoutMs}ms${this.stderrDetail()}`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: resolve,
                reject,
                timer,
            });
            this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
        });
    }
    handleLine(line) {
        const trimmed = line.trim();
        if (!trimmed)
            return;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            return;
        }
        const pending = this.pending.get(parsed.id);
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pending.delete(parsed.id);
        if (parsed.error) {
            pending.reject(new Error(parsed.error.message ?? `Native recording error ${parsed.error.code ?? ''}`.trim()));
        }
        else {
            pending.resolve(parsed.result);
        }
    }
    rejectAll(error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }
    stderrDetail() {
        const stderr = Buffer.concat(this.stderrChunks).toString('utf8').trim();
        return stderr ? `\n${stderr}` : '';
    }
}
async function startNativeSingleWindowRecording(input) {
    const binary = ensureBinary();
    const child = spawn(binary, [], { stdio: 'pipe' });
    const process = new NativeRecordingProcess(child, input);
    try {
        return await process.start();
    }
    catch (error) {
        await process.abort().catch(() => { });
        throw error;
    }
}
async function waitForChildExit(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null)
        return;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            child.off('close', onClose);
            reject(new Error('Timed out waiting for child process exit'));
        }, timeoutMs);
        const onClose = () => {
            clearTimeout(timer);
            resolve();
        };
        child.once('close', onClose);
    });
}
function probeRecordingBlackFrames(outPath) {
    const ffmpeg = detectFfmpeg();
    if (!ffmpeg)
        return { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true };
    try {
        const result = spawnSync(ffmpeg, [
            '-nostats',
            '-i', outPath,
            '-vf', 'fps=2,signalstats,metadata=print:file=-',
            '-an',
            '-f', 'null',
            '-',
        ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        return parseLuminance(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    }
    catch {
        return { sampleCount: 0, meanLuma: null, allBlack: false, skipped: true };
    }
}
async function getPermissionStatuses(filter) {
    const permissions = filter ?? [
        'accessibility',
        'screen-recording',
        'automation',
        'developer-tools',
    ];
    const now = Date.now();
    const states = await Promise.all(permissions.map(async (permission) => {
        const state = await probePermission(permission);
        return permissionStatus(permission, state, now);
    }));
    return states;
}
async function probePermission(permission) {
    if (process.platform !== 'darwin')
        return 'unsupported';
    if (permission === 'accessibility') {
        try {
            const { stdout } = await execFileAsync('/usr/bin/osascript', [
                '-e',
                'tell application "System Events" to get UI elements enabled',
            ], { timeout: 1_000 });
            return stdout.trim().toLowerCase() === 'true' ? 'granted' : 'denied';
        }
        catch {
            return 'unknown';
        }
    }
    if (permission === 'screen-recording') {
        try {
            await execFileAsync(ensureScreenRecordingPreflightBinary(), [], {
                timeout: 2_000,
                maxBuffer: 1024 * 1024,
            });
            return 'granted';
        }
        catch {
            return 'denied';
        }
    }
    // macOS exposes no non-prompting, daemon-safe public probe for Automation or
    // Developer Tools consent equivalent to AXIsProcessTrusted or CGPreflight.
    // Keep these unknown rather than fabricating a value from brittle UI state.
    return 'unknown';
}
function permissionStatus(permission, state, lastCheckedAt) {
    const requiredFor = {
        accessibility: ['macOS UI snapshots', 'macOS UI actions'],
        'screen-recording': ['screenshots', 'video capture'],
        automation: ['opening System Settings', 'controlling helper applications'],
        'developer-tools': ['web CDP debugging'],
    };
    return {
        permission,
        state,
        requiredFor: requiredFor[permission],
        canPrompt: process.platform === 'darwin',
        settingsUrl: process.platform === 'darwin' ? settingsUrl(permission) : undefined,
        lastCheckedAt,
    };
}
function settingsUrl(permission) {
    switch (permission) {
        case 'accessibility':
            return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
        case 'screen-recording':
            return 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
        case 'automation':
            return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';
        case 'developer-tools':
            return 'x-apple.systempreferences:com.apple.preference.security?Privacy_DeveloperTools';
    }
}
async function openPermissionSettings(permissions) {
    const url = settingsUrl(permissions[0]);
    if (url)
        await execFileAsync('/usr/bin/open', [url], { timeout: 1_000 });
}
async function listMacWindows() {
    if (process.platform !== 'darwin')
        return [];
    const sckWindows = await listScreenCaptureKitWindowsSerial().catch(() => []);
    if (sckWindows.length > 0)
        return sckWindows;
    return listAccessibilityWindows().catch(() => []);
}
async function listScreenCaptureKitWindowsSerial() {
    if (screenCaptureKitWindowList)
        return screenCaptureKitWindowList;
    const pending = listScreenCaptureKitWindows();
    screenCaptureKitWindowList = pending;
    try {
        return await pending;
    }
    finally {
        if (screenCaptureKitWindowList === pending)
            screenCaptureKitWindowList = undefined;
    }
}
async function listScreenCaptureKitWindows() {
    const binary = ensureCompositeBinary();
    const { stdout } = await execFileAsync(binary, ['--list-windows'], {
        timeout: 10_000,
        maxBuffer: 4 * 1024 * 1024,
    });
    return parseScreenCaptureKitWindows(stdout);
}
function parseScreenCaptureKitWindows(stdout) {
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed.windows))
        return [];
    return parsed.windows.flatMap((entry) => {
        if (!entry || typeof entry !== 'object')
            return [];
        const record = entry;
        const windowId = numberValue(record.windowId);
        const processId = numberValue(record.processId);
        const x = numberValue(record.x);
        const y = numberValue(record.y);
        const width = numberValue(record.width);
        const height = numberValue(record.height);
        const layer = numberValue(record.layer);
        if (windowId === undefined
            || processId === undefined
            || x === undefined
            || y === undefined
            || width === undefined
            || height === undefined
            || layer === undefined) {
            return [];
        }
        return [{
                windowId,
                appName: stringValue(record.appName),
                bundleIdentifier: optionalStringValue(record.bundleIdentifier),
                processId,
                title: stringValue(record.title),
                x,
                y,
                width,
                height,
                onScreen: booleanValue(record.onScreen, true),
                active: optionalBooleanValue(record.active),
                layer,
            }];
    });
}
async function listAccessibilityWindows() {
    const script = `
set output to ""
tell application "System Events"
  repeat with p in (application processes whose background only is false)
    set appName to name of p
    set appPid to unix id of p
    set bundleId to ""
    try
      set bundleId to bundle identifier of p
    end try
    repeat with w in windows of p
      try
        set windowTitle to name of w
        set windowPosition to position of w
        set windowSize to size of w
        set output to output & appPid & tab & appName & tab & bundleId & tab & windowTitle & tab & item 1 of windowPosition & tab & item 2 of windowPosition & tab & item 1 of windowSize & tab & item 2 of windowSize & linefeed
      end try
    end repeat
  end repeat
end tell
return output
`;
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
    });
    return stdout.split(/\r?\n/).filter(Boolean).map((line, index) => {
        const [pid, appName, bundleIdentifier, title, x, y, width, height] = line.split('\t');
        return {
            windowId: index + 1,
            appName: appName ?? '',
            bundleIdentifier: bundleIdentifier || undefined,
            processId: Number.parseInt(pid ?? '0', 10) || 0,
            title: title ?? '',
            x: Number.parseFloat(x ?? '0') || 0,
            y: Number.parseFloat(y ?? '0') || 0,
            width: Number.parseFloat(width ?? '0') || 0,
            height: Number.parseFloat(height ?? '0') || 0,
            onScreen: true,
            active: null,
            layer: 0,
        };
    });
}
function numberValue(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
function stringValue(value) {
    return typeof value === 'string' ? value : '';
}
function optionalStringValue(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function booleanValue(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function optionalBooleanValue(value) {
    return typeof value === 'boolean' ? value : null;
}
//# sourceMappingURL=core-impl.js.map