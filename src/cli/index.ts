// src/cli/index.ts
//
// Spectra CLI entrypoint. Routes argv to a subcommand handler.
//
// Subcommands:
//   spectra                     → stdio MCP server (legacy Claude Code path)
//   spectra daemon [--port N]   → HTTP daemon (Network surface for SwiftUI app)
//   spectra version             → print { apiVersion, daemonVersion }
//   spectra --help              → usage
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import { startStdio } from '../mcp/server.js'
import { startHttpServer, DEFAULT_PORT } from '../mcp/http.js'
import { getVersionInfo } from '../mcp/version.js'

interface ParsedArgs {
  command: 'stdio' | 'daemon' | 'version' | 'help'
  port?: number
}

function parseArgs(argv: string[]): ParsedArgs {
  // argv: [node, script, ...rest]
  const rest = argv.slice(2)
  if (rest.length === 0) return { command: 'stdio' }
  const head = rest[0]
  if (head === '--help' || head === '-h' || head === 'help') return { command: 'help' }
  if (head === 'version' || head === '--version' || head === '-v') return { command: 'version' }
  if (head === 'daemon') {
    let port = DEFAULT_PORT
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === '--port' && i + 1 < rest.length) {
        const n = Number(rest[i + 1])
        if (!Number.isFinite(n) || n < 1 || n > 65535) {
          throw new Error(`Invalid --port: ${rest[i + 1]}`)
        }
        port = n
        i++
      }
    }
    return { command: 'daemon', port }
  }
  // Unknown subcommand — fall through to stdio for backward compatibility
  // (plugin.json uses bare `node server.js`)
  return { command: 'stdio' }
}

const USAGE = `spectra — UI automation MCP server

Usage:
  spectra                       Start stdio MCP server (default; used by Claude Code)
  spectra daemon [--port N]     Start HTTP daemon on 127.0.0.1:N (default 47823)
  spectra version               Print API + daemon version
  spectra --help                Show this message

The HTTP daemon writes a bearer token to ~/.spectra/daemon.token (mode 0600).
Required on every request to /mcp.
`

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

    case 'daemon': {
      const running = await startHttpServer({ port: args.port })
      const v = getVersionInfo()
      // stderr so stdout stays clean for any consumers that pipe it
      process.stderr.write(
        `spectra daemon ${v.daemonVersion} listening on 127.0.0.1:${running.port}\n`
      )
      process.stderr.write(`bearer token: ~/.spectra/daemon.token\n`)
      // Keep process alive until signal
      const shutdown = async (sig: string) => {
        process.stderr.write(`\n${sig} received — shutting down\n`)
        await running.close()
        process.exit(0)
      }
      process.once('SIGINT', () => void shutdown('SIGINT'))
      process.once('SIGTERM', () => void shutdown('SIGTERM'))
      // node will exit when there are no more open handles; the HTTP server
      // keeps us alive
      return
    }
  }
}

main().catch((err: Error) => {
  console.error(err)
  process.exit(1)
})
