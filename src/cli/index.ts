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
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { startStdio } from '../mcp/server.js'
import { getVersionInfo } from '../mcp/version.js'
import { apiOperations } from '../contract/schemas.js'
import { DaemonClient, DaemonError } from '../client/daemon-client.js'
import { spawnDaemonBootstrap } from '../client/bootstrap.js'
import type { CoreApiOperation } from '../contract/wire.js'

const OPERATIONS = new Set<string>(apiOperations)

interface ParsedArgs {
  command: 'stdio' | 'daemon' | 'version' | 'help' | 'operation'
  operation?: CoreApiOperation
  paramsJson?: string
}

function parseArgs(argv: string[]): ParsedArgs {
  const rest = argv.slice(2)
  if (rest.length === 0) return { command: 'stdio' }
  const head = rest[0]
  if (head === '--help' || head === '-h' || head === 'help') return { command: 'help' }
  if (head === 'version' || head === '--version' || head === '-v') return { command: 'version' }
  if (head === 'daemon') return { command: 'daemon' }
  if (OPERATIONS.has(head)) {
    return { command: 'operation', operation: head as CoreApiOperation, paramsJson: rest[1] }
  }
  // Unknown subcommand — fall through to stdio for backward compatibility
  // (plugin.json uses bare `node server.js`).
  return { command: 'stdio' }
}

const USAGE = `spectra — coreless daemon forwarder + MCP proxy

Usage:
  spectra                       Start stdio MCP proxy (default; used by Claude Code)
  spectra daemon                Exec the GUI-session daemon (dist/daemon/server.js)
  spectra <operation> [json]    Forward a CoreApi operation to the running daemon
  spectra version               Print { apiVersion, daemonVersion } from the contract
  spectra --help                Show this message

Operations (forwarded over ~/.spectra/daemon.sock):
  ${apiOperations.join(', ')}

Examples:
  spectra health
  spectra createSession '{"target":"http://localhost:3000"}'
  spectra listSessions '{"includeClosed":true}'
`

/** Resolve the compiled BE daemon entry (dist/daemon/server.js). */
function resolveDaemonEntry(): string {
  // dist/cli/index.js → ../daemon/server.js
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', 'daemon', 'server.js')
}

function execDaemon(): Promise<number> {
  const entry = resolveDaemonEntry()
  if (!existsSync(entry)) {
    process.stderr.write(
      `spectra daemon: daemon entry not found at ${entry}.\n` +
        `Build the backend daemon first (npm run build), or start the Spectra menu-bar app.\n`,
    )
    return Promise.resolve(1)
  }
  return new Promise<number>((resolveExit) => {
    const child = spawn(process.execPath, [entry], { stdio: 'inherit' })
    const forward = (sig: NodeJS.Signals) => { try { child.kill(sig) } catch { /* already gone */ } }
    process.on('SIGINT', () => forward('SIGINT'))
    process.on('SIGTERM', () => forward('SIGTERM'))
    child.on('exit', (code) => resolveExit(code ?? 0))
    child.on('error', (err) => {
      process.stderr.write(`spectra daemon: failed to start — ${err.message}\n`)
      resolveExit(1)
    })
  })
}

async function forwardOperation(operation: CoreApiOperation, paramsJson?: string): Promise<number> {
  let params: unknown
  if (paramsJson && paramsJson.trim().length > 0) {
    try {
      params = JSON.parse(paramsJson)
    } catch (err) {
      process.stderr.write(`spectra ${operation}: invalid JSON params — ${(err as Error).message}\n`)
      return 1
    }
  }
  const probe = new DaemonClient({ surface: 'cli', callerName: 'spectra-cli' })
  const client = new DaemonClient({
    surface: 'cli',
    callerName: 'spectra-cli',
    bootstrap: spawnDaemonBootstrap(probe),
  })
  try {
    const result = await client.call(operation, params)
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return 0
  } catch (err) {
    if (err instanceof DaemonError) {
      process.stderr.write(JSON.stringify({ error: err.message, code: err.code, hint: err.hint }, null, 2) + '\n')
      return 1
    }
    process.stderr.write(`spectra ${operation}: ${(err as Error).message}\n`)
    return 1
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  switch (args.command) {
    case 'help':
      process.stdout.write(USAGE)
      return
    case 'version':
      process.stdout.write(JSON.stringify(getVersionInfo()) + '\n')
      return
    case 'stdio':
      await startStdio()
      return
    case 'daemon':
      process.exit(await execDaemon())
      return
    case 'operation':
      process.exit(await forwardOperation(args.operation!, args.paramsJson))
      return
  }
}

main().catch((err: Error) => {
  console.error(err)
  process.exit(1)
})
