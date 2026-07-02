// macos/Spectra/DaemonCore/verify-g1-suite.ts
//
// M3.G1 acceptance harness — compile the Swift daemon-core, boot it with the
// conformance seed (SPECTRA_CONFORMANCE_SEED=1) on an isolated temp HOME/socket,
// and run the M2B oracle's socket client + shape validator across ALL 11 G1
// control-plane ops, asserting each returns a spec-conformant envelope+shape.
// This is the per-op-group parity check the M3 plan requires before a routing
// flip (plan §Acceptance (a),(d)). Native/capture ops are NOT part of G1 and are
// not exercised here (they stay on the TS daemon per the routing table).
//
// Run: npx tsx macos/Spectra/DaemonCore/verify-g1-suite.ts
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { callOperation } from '../../../tests/conformance/lib/socket-client.js'
import { validateShape } from '../../../tests/conformance/lib/result-validator.js'
import { apiResponseEnvelopeSchema } from '../../../src/contract/schemas.js'

const spec = JSON.parse(readFileSync('src/contract/contract.spec.json', 'utf8'))
const here = new URL('.', import.meta.url).pathname
const SEED_SESSION = 'conformance-seed'

// The 11 G1 control-plane ops + a representative valid payload for each. Reads
// route to the seeded session; closers run last (they mutate the seed).
const G1_CASES: Array<{ op: string; params: unknown }> = [
  { op: 'health', params: {} },
  { op: 'getPermissions', params: {} },
  { op: 'requestPermissions', params: { permissions: ['accessibility'] } },
  { op: 'listWindows', params: {} },
  { op: 'listSessions', params: {} },
  { op: 'library', params: { action: 'status' } },
  { op: 'getSession', params: { sessionId: SEED_SESSION } },
  { op: 'getRun', params: { sessionId: SEED_SESSION } },
  { op: 'recordLlmUsage', params: { sessionId: SEED_SESSION, usage: { promptTokens: 1, completionTokens: 1 } } },
  { op: 'closeSession', params: { sessionId: SEED_SESSION } },
  { op: 'closeAllSessions', params: {} },
]

const bin = join(tmpdir(), `spectra-g1-suite-${process.pid}`)
const home = mkdtempSync(join(tmpdir(), 'spectra-g1-home-'))
const sock = join(home, 'daemon.sock')

const swiftFiles = execFileSync('bash', ['-c', `ls ${here}/*.swift`]).toString().trim().split('\n')
console.log('· compiling the Swift daemon-core…')
execFileSync('swiftc', [...swiftFiles, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'] })
console.log('  ✔ compiled\n· booting with SPECTRA_CONFORMANCE_SEED=1 on an isolated socket…')

const daemon = spawn(bin, [], {
  env: { ...process.env, SPECTRA_DAEMON_SOCKET: sock, SPECTRA_CONFORMANCE_SEED: '1', HOME: home, SPECTRA_HOME: home },
  stdio: 'ignore',
})

async function main() {
  for (let i = 0; i < 50 && !existsSync(sock); i++) await new Promise((r) => setTimeout(r, 100))
  if (!existsSync(sock)) throw new Error('Swift daemon did not bind the socket')

  let pass = 0
  const failures: string[] = []
  for (const { op, params } of G1_CASES) {
    const r = await callOperation({ socketPath: sock, operation: op, params })
    const env = apiResponseEnvelopeSchema.safeParse(r.body)
    if (!env.success) { failures.push(`${op}: envelope invalid — ${env.error.message}`); continue }
    if (!env.data.ok) { failures.push(`${op}: ok:false ${JSON.stringify(env.data.error)}`); continue }
    const shape = validateShape(spec.operations[op].result, env.data.result)
    if (shape.ok) { pass++; console.log(`  ✔ ${op.padEnd(20)} SHAPE CONFORMANT`) }
    else failures.push(`${op}: shape — ${shape.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`)
  }

  console.log(`\n=== G1 conformance vs the Swift daemon: ${pass}/${G1_CASES.length} ops SHAPE CONFORMANT ===`)
  if (failures.length) { console.log('FAILURES:\n' + failures.map((f) => '  ✗ ' + f).join('\n')); process.exitCode = 1 }
  else console.log('✔ all G1 control-plane ops verified against the Swift daemon over the real socket')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => { daemon.kill('SIGTERM'); try { rmSync(home, { recursive: true, force: true }) } catch {} })
