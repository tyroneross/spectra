// macos/Spectra/DaemonCore/verify-swift-op.ts
//
// M3.G1 dev harness — compile the Swift daemon-core, run it on a temp socket,
// call one op through the M2B oracle's socket client, and validate the response
// against the frozen enriched spec. The per-handler verification loop for the
// parallel G1 groups: `npx tsx macos/Spectra/DaemonCore/verify-swift-op.ts <op> '<params-json>'`.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { callOperation } from '../../../tests/conformance/lib/socket-client.js'
import { validateShape } from '../../../tests/conformance/lib/result-validator.js'
import { apiResponseEnvelopeSchema } from '../../../src/contract/schemas.js'

const op = process.argv[2]
const paramsArg = process.argv[3]
if (!op) {
  console.error('usage: verify-swift-op.ts <operation> [params-json]')
  process.exit(2)
}
const params = paramsArg ? JSON.parse(paramsArg) : {}
const spec = JSON.parse(readFileSync('src/contract/contract.spec.json', 'utf8'))
const here = new URL('.', import.meta.url).pathname
const bin = join(tmpdir(), `spectra-g1-verify-${process.pid}`)
const sock = join(tmpdir(), `spectra-g1-${process.pid}.sock`)

// 1. compile the whole DaemonCore module
const swiftFiles = execFileSync('bash', ['-c', `ls ${here}/*.swift`]).toString().trim().split('\n')
execFileSync('swiftc', [...swiftFiles, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'] })

// 2. run it on a temp socket
if (existsSync(sock)) rmSync(sock)
const daemon = spawn(bin, [], { env: { ...process.env, SPECTRA_DAEMON_SOCKET: sock }, stdio: 'ignore' })
const cleanup = () => { daemon.kill('SIGTERM'); try { rmSync(sock) } catch {} }
try {
  for (let i = 0; i < 40 && !existsSync(sock); i++) await new Promise((r) => setTimeout(r, 100))
  if (!existsSync(sock)) throw new Error('daemon did not bind the socket')

  // 3. call + validate
  const r = await callOperation({ socketPath: sock, operation: op, params })
  const env = apiResponseEnvelopeSchema.safeParse(r.body)
  if (!env.success) { console.log(`ENVELOPE INVALID: ${env.error.message}`); process.exitCode = 1 }
  else if (env.data.ok) {
    const shape = validateShape(spec.operations[op].result, env.data.result)
    console.log(`result: ${JSON.stringify(env.data.result).slice(0, 600)}`)
    console.log(`SHAPE CONFORMANT: ${shape.ok}${shape.ok ? '' : ' — ' + JSON.stringify(shape.issues)}`)
    if (!shape.ok) process.exitCode = 1
  } else {
    const inTaxonomy = spec.operations[op].errorCodes.includes(env.data.error.code)
    console.log(`error: ${env.data.error.code} — in declared taxonomy: ${inTaxonomy}`)
    if (!inTaxonomy) process.exitCode = 1
  }
} finally {
  cleanup()
}
