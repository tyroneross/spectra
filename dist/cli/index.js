// src/cli/index.ts
//
// Spectra CLI entrypoint. Routes argv to a subcommand handler.
//
// Subcommands:
//   spectra                     → stdio MCP server (coreless daemon proxy)
//   spectra daemon              → exec the BE daemon bin as a subprocess
//   spectra <operation> [json]  → forward a CoreApi operation to the daemon
//   spectra version             → print { apiVersion, daemonVersion } from contract
//   spectra --help              → usage
//
// `spectra <operation>` and the stdio proxy both forward to the GUI-session
// daemon over the unix socket; this CLI imports NO core.
//
// dist/ is a committed build artifact; the pre-push hook (scripts/git-hooks/
// pre-push) rebuilds and commits it automatically when src/ changes.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { startStdio } from '../mcp/server.js';
import { getVersionInfo } from '../mcp/version.js';
import { apiOperations } from '../contract/schemas.js';
import { DaemonClient, DaemonError } from '../client/daemon-client.js';
import { spawnDaemonBootstrap } from '../client/bootstrap.js';
import { scanFrames, FrameScanInputError, FfmpegUnavailableError, } from '../media/frame-secret-scan.js';
const OPERATIONS = new Set(apiOperations);
function parseScanFramesArgs(rest) {
    let input;
    let fps;
    let out;
    let json = false;
    const allow = [];
    const rangesMs = [];
    for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (arg === '--fps') {
            const value = rest[++i];
            if (value === undefined)
                return null;
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed <= 0)
                return null;
            fps = parsed;
        }
        else if (arg === '--out') {
            const value = rest[++i];
            if (value === undefined)
                return null;
            out = value;
        }
        else if (arg === '--allow') {
            const value = rest[++i];
            if (value === undefined)
                return null;
            allow.push(value);
        }
        else if (arg === '--range-ms') {
            const value = rest[++i];
            if (value === undefined)
                return null;
            const match = /^(\d+):(\d+)$/.exec(value);
            if (!match)
                return null;
            const startMs = Number(match[1]);
            const endMs = Number(match[2]);
            if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs)
                return null;
            rangesMs.push({ startMs, endMs });
        }
        else if (arg === '--json') {
            json = true;
        }
        else if (!arg.startsWith('--') && input === undefined) {
            input = arg;
        }
        else {
            return null;
        }
    }
    if (!input)
        return null;
    return { input, fps, out, allow, rangesMs, json };
}
function parseArgs(argv) {
    const rest = argv.slice(2);
    if (rest.length === 0)
        return { command: 'stdio' };
    const head = rest[0];
    if (head === '--help' || head === '-h' || head === 'help')
        return { command: 'help' };
    if (head === 'version' || head === '--version' || head === '-v')
        return { command: 'version' };
    if (head === 'daemon')
        return { command: 'daemon' };
    if (head === 'scan-frames') {
        return { command: 'scan-frames', scanFrames: parseScanFramesArgs(rest.slice(1)) ?? undefined };
    }
    if (OPERATIONS.has(head)) {
        return { command: 'operation', operation: head, paramsJson: rest[1] };
    }
    // Unknown subcommand — fall through to stdio for backward compatibility
    // (plugin.json uses bare `node server.js`).
    return { command: 'stdio' };
}
const USAGE = `spectra — coreless daemon forwarder + MCP proxy

Usage:
  spectra                       Start stdio MCP proxy (default; used by Claude Code)
  spectra daemon                Exec the GUI-session daemon (dist/daemon/server.js)
  spectra <operation> [json]    Forward a CoreApi operation to the running daemon
  spectra scan-frames <input>   Pre-publish secret/privacy scan of a recording's frames
  spectra version               Print { apiVersion, daemonVersion } from the contract
  spectra --help                Show this message

Environment:
  SPECTRA_DAEMON_SOCKET         Override the daemon socket path (default ~/.spectra/daemon.sock)

Operations (forwarded over ~/.spectra/daemon.sock, or $SPECTRA_DAEMON_SOCKET):
  ${apiOperations.join(', ')}

scan-frames options:
  --fps <n>          Sample rate for video input (default: 1)
  --out <path>       Write the full JSON report to this path
  --allow <regex>    Suppress matches (repeatable) — e.g. your own home path
  --range-ms <a:b>   Scan an exact millisecond range; repeat for disjoint sharp windows
  --json             Print the full JSON report to stdout instead of a summary

scan-frames exit codes:
  0  clean — no findings
  1  review — medium/low findings (email, home path, generic secret-shaped text)
  2  blocked — a high-severity finding (API key, token, private key, etc.)
  3  ffmpeg/OCR engine unavailable, or input not found

Examples:
  spectra health
  spectra createSession '{"target":"http://localhost:3000"}'
  spectra listSessions '{"includeClosed":true}'
  spectra scan-frames demo.mp4 --fps 2 --out report.json
  spectra scan-frames demo.mp4 --fps 30 --range-ms 12000:18000 --range-ms 41000:56000
  spectra scan-frames screenshot.png --allow '/Users/tyrone.*'
`;
/** Resolve the compiled BE daemon entry (dist/daemon/server.js). */
function resolveDaemonEntry() {
    // dist/cli/index.js → ../daemon/server.js
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, '..', 'daemon', 'server.js');
}
function execDaemon() {
    const entry = resolveDaemonEntry();
    if (!existsSync(entry)) {
        process.stderr.write(`spectra daemon: daemon entry not found at ${entry}.\n` +
            `Build the backend daemon first (npm run build), or start the Spectra menu-bar app.\n`);
        return Promise.resolve(1);
    }
    return new Promise((resolveExit) => {
        const child = spawn(process.execPath, [entry], { stdio: 'inherit' });
        const forward = (sig) => { try {
            child.kill(sig);
        }
        catch { /* already gone */ } };
        process.on('SIGINT', () => forward('SIGINT'));
        process.on('SIGTERM', () => forward('SIGTERM'));
        child.on('exit', (code) => resolveExit(code ?? 0));
        child.on('error', (err) => {
            process.stderr.write(`spectra daemon: failed to start — ${err.message}\n`);
            resolveExit(1);
        });
    });
}
async function forwardOperation(operation, paramsJson) {
    // Omitting the JSON argument means "no arguments", which the contract spells
    // as {} — not as a missing value. `spectra health` (the example this file's
    // own --help prints) failed with "Invalid params for health: Required" until
    // this defaulted, while listSessions/listWindows/getPermissions happened to
    // work bare. Same shape for every operation now.
    let params = {};
    if (paramsJson && paramsJson.trim().length > 0) {
        try {
            params = JSON.parse(paramsJson);
        }
        catch (err) {
            process.stderr.write(`spectra ${operation}: invalid JSON params — ${err.message}\n`);
            return 1;
        }
    }
    params = normalizeForwardedParams(operation, params);
    const probe = new DaemonClient({ surface: 'cli', callerName: 'spectra-cli' });
    const client = new DaemonClient({
        surface: 'cli',
        callerName: 'spectra-cli',
        bootstrap: spawnDaemonBootstrap(probe),
    });
    try {
        const result = await client.call(operation, params);
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return 0;
    }
    catch (err) {
        if (err instanceof DaemonError) {
            process.stderr.write(JSON.stringify({ error: err.message, code: err.code, hint: err.hint }, null, 2) + '\n');
            return 1;
        }
        process.stderr.write(`spectra ${operation}: ${err.message}\n`);
        return 1;
    }
}
function normalizeForwardedParams(operation, params) {
    if (operation === 'recordComposite')
        return resolveOutPath(params);
    if (operation === 'demo'
        && params
        && typeof params === 'object'
        && !Array.isArray(params)
        && params.action === 'record-composite') {
        return resolveOutPath(params);
    }
    return params;
}
function resolveOutPath(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params))
        return params;
    const outPath = params.outPath;
    if (typeof outPath !== 'string' || outPath.length === 0 || isAbsolute(outPath))
        return params;
    return { ...params, outPath: resolve(process.cwd(), outPath) };
}
function severityRank(sev) {
    return sev === 'high' ? 0 : sev === 'medium' ? 1 : 2;
}
function printScanFramesSummary(report) {
    process.stdout.write(`spectra scan-frames: ${report.frameCount} frame(s) sampled @ ${report.fps}fps via ${report.engine}\n`);
    if (report.unscannedReason) {
        process.stdout.write(`  not scanned — ${report.unscannedReason}\n`);
        return;
    }
    if (report.longLines > 0) {
        process.stdout.write(`  ${report.longLines} line(s) exceeded 4 KB and were scanned in overlapping windows\n`);
    }
    if (report.findings.length === 0) {
        process.stdout.write('  verdict: clean — no findings\n');
        return;
    }
    process.stdout.write(`  verdict: ${report.verdict} — ${report.findings.length} finding(s)\n`);
    const sorted = [...report.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    for (const f of sorted) {
        process.stdout.write(`  [${f.severity}] ${f.description} (${f.patternId}) — ${f.redacted} @ frame ${f.frameIndex} (${f.tMs}ms)\n`);
    }
}
async function runScanFrames(args) {
    if (!args) {
        process.stderr.write('spectra scan-frames: invalid arguments\n\nUsage:\n  spectra scan-frames <video-or-image> [--fps 1] [--range-ms start:end]... [--out <report.json>] [--allow <regex>]... [--json]\n');
        return 3;
    }
    const inputPath = isAbsolute(args.input) ? args.input : resolve(process.cwd(), args.input);
    let allow;
    try {
        allow = args.allow.map((pattern) => new RegExp(pattern));
    }
    catch (err) {
        process.stderr.write(`spectra scan-frames: invalid --allow regex — ${err.message}\n`);
        return 3;
    }
    let report;
    try {
        report = await scanFrames(inputPath, { fps: args.fps, allow, rangesMs: args.rangesMs });
    }
    catch (err) {
        if (err instanceof FrameScanInputError || err instanceof FfmpegUnavailableError) {
            process.stderr.write(`spectra scan-frames: ${err.message}\n`);
            return 3;
        }
        process.stderr.write(`spectra scan-frames: ${err.message}\n`);
        return 3;
    }
    if (args.out) {
        const outPath = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out);
        await writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    }
    if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    }
    else {
        printScanFramesSummary(report);
    }
    if (report.unscannedReason)
        return 3;
    if (report.verdict === 'blocked')
        return 2;
    if (report.verdict === 'review')
        return 1;
    return 0;
}
async function main() {
    const args = parseArgs(process.argv);
    switch (args.command) {
        case 'help':
            process.stdout.write(USAGE);
            return;
        case 'version':
            process.stdout.write(JSON.stringify(getVersionInfo()) + '\n');
            return;
        case 'stdio':
            await startStdio();
            return;
        case 'daemon':
            process.exit(await execDaemon());
            return;
        case 'operation':
            process.exit(await forwardOperation(args.operation, args.paramsJson));
            return;
        case 'scan-frames':
            process.exit(await runScanFrames(args.scanFrames));
            return;
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map