import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { getStoragePath } from '../core/storage.js';
function getDefaultOutputPath(cwd) {
    const timestamp = Date.now();
    return join(getStoragePath(cwd), 'recordings', `${timestamp}.cast`);
}
export async function recordTerminal(options) {
    const { command, args = [], shell = true, cwd, env, cols = 120, rows = 40, maxDuration = 300_000, outputPath, } = options;
    const castFile = outputPath ?? getDefaultOutputPath(cwd);
    // Ensure output directory exists
    mkdirSync(dirname(castFile), { recursive: true });
    const stream = createWriteStream(castFile, { encoding: 'utf8' });
    // Write asciicast v2 header
    const header = {
        version: 2,
        width: cols,
        height: rows,
        timestamp: Math.floor(Date.now() / 1000),
        env: {
            SHELL: process.env.SHELL ?? '/bin/sh',
            TERM: process.env.TERM ?? 'xterm-256color',
        },
    };
    stream.write(JSON.stringify(header) + '\n');
    const startTime = performance.now();
    let outputSize = 0;
    let lines = 0;
    function elapsed() {
        return (performance.now() - startTime) / 1000;
    }
    function writeEvent(type, data) {
        const event = JSON.stringify([elapsed(), type, data]);
        stream.write(event + '\n');
        outputSize += data.length;
        lines++;
    }
    return new Promise((resolve, reject) => {
        const spawnArgs = shell ? [] : args;
        const spawnCommand = shell ? command + (args.length ? ' ' + args.join(' ') : '') : command;
        const child = spawn(spawnCommand, spawnArgs, {
            shell,
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd,
            env: { ...process.env, ...env, COLUMNS: String(cols), LINES: String(rows) },
        });
        const killTimer = setTimeout(() => {
            console.warn(`[recorder] max duration ${maxDuration}ms reached — killing process`);
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 2000);
        }, maxDuration);
        child.stdout?.on('data', (chunk) => {
            writeEvent('o', chunk.toString());
        });
        child.stderr?.on('data', (chunk) => {
            writeEvent('o', chunk.toString());
        });
        child.on('error', (err) => {
            clearTimeout(killTimer);
            stream.end(() => reject(err));
        });
        child.on('close', (code) => {
            clearTimeout(killTimer);
            const duration = (performance.now() - startTime) / 1000;
            stream.end(() => {
                resolve({
                    castFile,
                    exitCode: code ?? 0,
                    duration,
                    outputSize,
                    lines,
                });
            });
        });
    });
}
//# sourceMappingURL=recorder.js.map