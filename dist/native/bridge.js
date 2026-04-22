// src/native/bridge.ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { ensureBinary } from './compiler.js';
const REQUEST_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 2_000;
export class NativeBridge {
    process = null;
    readline = null;
    nextId = 0;
    pending = new Map();
    heartbeatTimer = null;
    _ready = false;
    get ready() {
        return this._ready && this.process !== null && !this.process.killed;
    }
    async start() {
        if (this.ready)
            return;
        const binaryPath = ensureBinary();
        this.process = spawn(binaryPath, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.process.on('exit', (code) => {
            this._ready = false;
            // Reject all pending requests
            for (const [, req] of this.pending) {
                clearTimeout(req.timer);
                req.reject(new Error('Native process exited unexpectedly'));
            }
            this.pending.clear();
        });
        // Pipe stderr to debug log
        this.process.stderr?.on('data', (data) => {
            // Could log to file or debug output
        });
        // Set up line-based JSON reading from stdout
        this.readline = createInterface({ input: this.process.stdout });
        this.readline.on('line', (line) => this.handleLine(line));
        // Verify the binary is responsive
        this._ready = true;
        await this.send('ping');
        // Start heartbeat
        this.startHeartbeat();
    }
    async send(method, params) {
        if (!this.ready) {
            await this.start();
        }
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`Native request '${method}' timed out after ${REQUEST_TIMEOUT_MS / 1000}s. `
                        + 'The target app may be unresponsive.'));
                }
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(id, {
                resolve: resolve,
                reject,
                timer,
                method,
            });
            const msg = { id, method };
            if (params)
                msg.params = params;
            this.process.stdin.write(JSON.stringify(msg) + '\n');
        });
    }
    handleLine(line) {
        const trimmed = line.trim();
        if (!trimmed)
            return;
        let data;
        try {
            data = JSON.parse(trimmed);
        }
        catch {
            return; // Ignore non-JSON lines
        }
        if ('id' in data && this.pending.has(data.id)) {
            const { resolve, reject, timer } = this.pending.get(data.id);
            clearTimeout(timer);
            this.pending.delete(data.id);
            if (data.error) {
                reject(new Error(`Native error ${data.error.code}: ${data.error.message}`));
            }
            else {
                resolve(data.result);
            }
        }
    }
    startHeartbeat() {
        this.heartbeatTimer = setInterval(async () => {
            try {
                await Promise.race([
                    this.send('ping'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Heartbeat timeout')), HEARTBEAT_TIMEOUT_MS)),
                ]);
            }
            catch {
                // Heartbeat failed — restart
                await this.restart();
            }
        }, HEARTBEAT_INTERVAL_MS);
    }
    async restart() {
        this.stopHeartbeat();
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this._ready = false;
        await this.start();
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    async close() {
        this.stopHeartbeat();
        // Clear all pending
        for (const [, req] of this.pending) {
            clearTimeout(req.timer);
        }
        this.pending.clear();
        if (this.process) {
            // Try graceful shutdown
            try {
                this.process.stdin.write(JSON.stringify({ id: 0, method: 'quit' }) + '\n');
                await new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        this.process?.kill();
                        resolve();
                    }, 2000);
                    this.process.on('exit', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                });
            }
            catch {
                this.process?.kill();
            }
            this.process = null;
        }
        this._ready = false;
    }
}
// Singleton bridge shared across sessions
let sharedBridge = null;
export function getSharedBridge() {
    if (!sharedBridge) {
        sharedBridge = new NativeBridge();
    }
    return sharedBridge;
}
//# sourceMappingURL=bridge.js.map