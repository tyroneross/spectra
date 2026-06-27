import { spawn } from 'node:child_process';
export class NoopKeepAwakeController {
    recordings = new Set();
    get activeRecordings() {
        return this.recordings.size;
    }
    get engaged() {
        return false;
    }
    async recordingStarted(recordingId) {
        this.recordings.add(recordingId);
    }
    async recordingStopped(recordingId) {
        this.recordings.delete(recordingId);
    }
    async close() {
        this.recordings.clear();
    }
}
export class DaemonKeepAwakeController {
    recordings = new Set();
    command;
    args;
    platform;
    spawnProcess;
    proc;
    constructor(options = {}) {
        this.command = options.command ?? '/usr/bin/caffeinate';
        this.args = options.args ?? ['-d', '-i'];
        this.platform = options.platform ?? process.platform;
        this.spawnProcess = options.spawn ?? ((command, args) => spawn(command, args, { stdio: 'ignore' }));
    }
    get activeRecordings() {
        return this.recordings.size;
    }
    get engaged() {
        return this.proc !== undefined;
    }
    async recordingStarted(recordingId) {
        const wasIdle = this.recordings.size === 0;
        this.recordings.add(recordingId);
        if (wasIdle)
            await this.ensureEngaged();
    }
    async recordingStopped(recordingId) {
        this.recordings.delete(recordingId);
        if (this.recordings.size === 0) {
            await this.release();
        }
    }
    async close() {
        this.recordings.clear();
        await this.release();
    }
    async ensureEngaged() {
        if (this.platform !== 'darwin' || this.proc)
            return;
        const child = this.spawnProcess(this.command, this.args);
        this.proc = child;
        child.once('exit', () => {
            if (this.proc === child)
                this.proc = undefined;
        });
        child.once('error', () => {
            if (this.proc === child)
                this.proc = undefined;
        });
        await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error) => {
                if (settled)
                    return;
                settled = true;
                if (error)
                    reject(error);
                else
                    resolve();
            };
            child.once('error', (error) => finish(error));
            setImmediate(() => {
                if (this.proc === child)
                    finish();
                else
                    finish(new Error(`Failed to start keep-awake process: ${this.command}`));
            });
        });
    }
    async release() {
        const child = this.proc;
        if (!child)
            return;
        this.proc = undefined;
        child.kill();
    }
}
export function createKeepAwakeController() {
    return new DaemonKeepAwakeController();
}
//# sourceMappingURL=keep-awake.js.map