import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { DaemonApiError, NotYetImplementedError } from './errors.js';
import { health as daemonHealth } from './health.js';
import { NoopKeepAwakeController } from './keep-awake.js';
const execFileAsync = promisify(execFile);
const NEXT_RECORDING_CHUNK = 'Native ScreenCaptureKit recording remains in the next backend chunk; Phase 1 only owns daemon transport, dispatch, health, and non-recording CoreApi wiring.';
export function createCoreApi(options = {}) {
    return new CoreApiImplementation(options);
}
class CoreApiImplementation {
    ctx;
    startedAt;
    daemonVersion;
    healthProbe;
    keepAwake;
    constructor(options) {
        this.ctx = options.context ?? createContext();
        this.startedAt = options.startedAt ?? Date.now();
        this.daemonVersion = options.daemonVersion;
        this.healthProbe = options.healthProbe;
        this.keepAwake = options.keepAwake ?? new NoopKeepAwakeController();
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
        const windows = await listMacWindows();
        const app = params.app?.toLowerCase();
        const title = params.title?.toLowerCase();
        return {
            windows: windows.filter((window) => {
                if (params.onScreenOnly !== false && !window.onScreen)
                    return false;
                if (app && !window.appName.toLowerCase().includes(app))
                    return false;
                if (title && !window.title.toLowerCase().includes(title))
                    return false;
                return true;
            }),
        };
    }
    async createSession(params) {
        return handleConnect(params, this.ctx);
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
    async startRecording(_params) {
        throw new NotYetImplementedError('startRecording', NEXT_RECORDING_CHUNK);
    }
    async stopRecording(_params) {
        throw new NotYetImplementedError('stopRecording', NEXT_RECORDING_CHUNK);
    }
    async recordComposite(_params) {
        throw new NotYetImplementedError('recordComposite', NEXT_RECORDING_CHUNK);
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
            throw new NotYetImplementedError('demo(record-composite)', NEXT_RECORDING_CHUNK);
        }
        return handleDemo(params, this.ctx);
    }
    async autoRampDemo(params) {
        return handleDemo({ ...params, action: 'auto-ramp' }, this.ctx);
    }
    async close() {
        await this.keepAwake.close();
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
//# sourceMappingURL=core-impl.js.map