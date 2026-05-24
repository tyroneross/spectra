#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_PORT="${SPECTRA_CROSS_AGENT_WEB_PORT:-3000}"
DAEMON_PORT="${SPECTRA_CROSS_AGENT_DAEMON_PORT:-47824}"
USE_EXTERNAL_TARGET=0
if [[ -n "${SPECTRA_CROSS_AGENT_URL:-}" ]]; then
  USE_EXTERNAL_TARGET=1
fi
WEB_URL="${SPECTRA_CROSS_AGENT_URL:-http://127.0.0.1:${WEB_PORT}}"
export SPECTRA_CROSS_AGENT_WEB_PORT="$WEB_PORT"
export SPECTRA_CROSS_AGENT_DAEMON_PORT="$DAEMON_PORT"
export SPECTRA_CROSS_AGENT_URL="$WEB_URL"

WEB_PID=""
DAEMON_PID=""

cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
  if [[ -n "$WEB_PID" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_http() {
  local url="$1"
  local label="$2"
  for _ in $(seq 1 40); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "Timed out waiting for ${label}: ${url}" >&2
  return 1
}

cd "$ROOT"

if [[ ! -f dist/cli/index.js ]]; then
  npm run build
fi

if [[ "$USE_EXTERNAL_TARGET" == "0" ]]; then
  node --input-type=module >/tmp/spectra-cross-agent-fixture.log 2>&1 <<'NODE' &
import http from 'node:http'

const port = Number(process.env.SPECTRA_CROSS_AGENT_WEB_PORT ?? '3000')

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Spectra Cross-Agent Fixture</title>
    <style>
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f5ef;
        color: #18202a;
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        padding: 64px 24px;
      }
      h1 {
        font-size: 2rem;
        margin: 0 0 12px;
      }
      p {
        font-size: 1rem;
        line-height: 1.5;
        margin: 0 0 24px;
      }
      nav {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 28px;
      }
      button {
        border: 1px solid #223042;
        background: #223042;
        color: white;
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
        min-height: 44px;
        padding: 0 16px;
      }
      #state {
        border-left: 4px solid #b4562a;
        background: white;
        padding: 16px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Spectra Cross-Agent Fixture</h1>
      <p>This page gives host agents three explicit controls for a deterministic walkthrough smoke.</p>
      <nav aria-label="Walkthrough controls">
        <button type="button" aria-label="Open Sessions" onclick="setState('sessions', 'Sessions ready')">Open Sessions</button>
        <button type="button" aria-label="Open Export" onclick="setState('export', 'Export ready')">Open Export</button>
        <button type="button" aria-label="Open Guidance" onclick="setState('guidance', 'Guidance ready')">Open Guidance</button>
      </nav>
      <section aria-live="polite" id="state">Ready for walkthrough</section>
    </main>
    <script>
      function setState(hash, text) {
        location.hash = hash;
        document.getElementById('state').textContent = text;
      }
    </script>
  </body>
</html>`

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
})

server.listen(port, '127.0.0.1')

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
NODE
  WEB_PID="$!"
  wait_for_http "$WEB_URL" "cross-agent fixture"
else
  wait_for_http "$WEB_URL" "provided cross-agent target"
fi

node dist/cli/index.js daemon --port "$DAEMON_PORT" >/tmp/spectra-cross-agent-daemon.out 2>/tmp/spectra-cross-agent-daemon.err &
DAEMON_PID="$!"
wait_for_http "http://127.0.0.1:${DAEMON_PORT}/api/health" "Spectra daemon"

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.env.SPECTRA_CROSS_AGENT_DAEMON_PORT ?? '47824')
const target = process.env.SPECTRA_CROSS_AGENT_URL ?? `http://127.0.0.1:${process.env.SPECTRA_CROSS_AGENT_WEB_PORT ?? '3000'}`
const token = readFileSync(join(homedir(), '.spectra', 'daemon.token'), 'utf8').trim()

let mcpSessionId = null
let requestId = 0

function decodeMcpResponse(text) {
  if (text.includes('data:')) {
    const line = text.split('\n').find((value) => value.startsWith('data:'))
    if (!line) throw new Error(`No data line in event stream: ${text.slice(0, 200)}`)
    return JSON.parse(line.slice(5).trim())
  }
  return JSON.parse(text)
}

async function post(body, expectSession = false) {
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  if (mcpSessionId) headers['mcp-session-id'] = mcpSessionId

  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (res.status === 202) return null
  const text = await res.text()
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 400)}`)
  if (expectSession) {
    const sid = res.headers.get('mcp-session-id')
    if (sid) mcpSessionId = sid
  }
  return decodeMcpResponse(text)
}

async function callTool(name, args) {
  const resp = await post({
    jsonrpc: '2.0',
    id: ++requestId,
    method: 'tools/call',
    params: { name, arguments: args },
  })
  if (resp?.error) throw new Error(`Tool ${name}: ${resp.error.message ?? 'unknown error'}`)
  const text = resp?.result?.content?.[0]?.text
  if (typeof text !== 'string') throw new Error(`Tool ${name}: no text response`)
  return JSON.parse(text)
}

await post({
  jsonrpc: '2.0',
  id: ++requestId,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'spectra-cross-agent-smoke', version: '0.1.0' },
  },
}, true)
await post({ jsonrpc: '2.0', method: 'notifications/initialized' })

const connected = await callTool('spectra_connect', {
  target,
  name: 'cross-agent-walkthrough',
})
if (!connected.sessionId) throw new Error('spectra_connect did not return a sessionId')

const result = await callTool('spectra_walkthrough', {
  sessionId: connected.sessionId,
  clean: false,
  steps: [
    { intent: 'click Open Sessions', waitMs: 0 },
    { intent: 'click Open Export', waitMs: 0 },
    { intent: 'click Open Guidance', waitMs: 0 },
  ],
})

const screenshots = (result.results ?? [])
  .map((step) => step.screenshotPath)
  .filter(Boolean)

if (!result.success) {
  throw new Error(`walkthrough did not succeed: ${JSON.stringify(result)}`)
}
if (result.stepsCompleted !== 3) {
  throw new Error(`expected 3 completed steps, got ${result.stepsCompleted}`)
}
if (screenshots.length < 1) {
  throw new Error('walkthrough did not return any screenshot paths')
}

await callTool('spectra_session', {
  action: 'close',
  sessionId: connected.sessionId,
})

console.log(JSON.stringify({
  ok: true,
  sessionId: connected.sessionId,
  stepsCompleted: result.stepsCompleted,
  screenshots,
}, null, 2))
NODE
