import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createSpectraServer, spectraDemoInputShape } from '../../src/mcp/server.js'
import { mapToolCall } from '../../src/mcp/forward.js'
import { DemoSchema } from '../../src/mcp/tools/demo.js'
import { demoParamsSchema } from '../../src/contract/schemas.js'
import { DaemonClient } from '../../src/client/daemon-client.js'
import { createCoreApi } from '../../src/daemon/core-impl.js'
import { startDaemonServer } from '../../src/daemon/server.js'
import { ffmpeg } from '../../src/pipeline/story-process.js'
import { detectFfmpeg } from '../../src/media/ffmpeg.js'
import { runProcess } from '../../src/pipeline/story-process.js'

it('retains style/focus and composition fields through both public and daemon boundaries', () => {
  for (const action of ['polish-script', 'polish-clip']) {
    const payload = { action, input: '/tmp/a.mp4', out: '/tmp/out.mp4', clicksJson: [], script: { beats: [] }, style: 'warm', autoFocus: { app: 'Example' }, spotlight: { focal: { x: 0, y: 0, w: 30, h: 20 } } }
    const publicInput = z.object(spectraDemoInputShape).parse(payload)
    const call = mapToolCall('spectra_demo', publicInput)
    const gate = demoParamsSchema.parse(call.params)
    expect(DemoSchema.parse(gate)).toMatchObject({ action, style: 'warm', autoFocus: { app: 'Example' }, spotlight: payload.spotlight })
  }
  expect(demoParamsSchema.safeParse({ action: 'compose', storyPath: 'http://example.com', outDir: '/tmp/new' }).success).toBe(false)
  expect(demoParamsSchema.safeParse({ action: 'compose-status', outDir: './relative' }).success).toBe(false)
})

describe.skipIf(!detectFfmpeg())('actual MCP SDK -> Unix daemon -> composer; CLI status', () => {
  it('acknowledges and polls the same job across agent-neutral transports', async () => {
    const dir = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'sp-story-'))
    const api = createCoreApi()
    const socketPath = join(dir, 'daemon.sock')
    const daemon = await startDaemonServer({ api, socketPath, unix: { capabilities: ['demo:write'], surface: 'test', peerCredentials: () => ({ uid: process.getuid?.() ?? 501, pid: process.pid }) } })
    const transportClient = new DaemonClient({ socketPath, surface: 'test' })
    const server = createSpectraServer(transportClient)
    const client = new Client({ name: 'host-neutral-test', version: '1' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    try {
      await server.connect(b); await client.connect(a)
      const input = join(dir, 'fixture.mp4'), storyPath = join(dir, 'story.json'), outDir = join(dir, 'out')
      await ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input])
      await writeFile(storyPath, JSON.stringify({ schemaVersion: 1, id: 'sdk', title: 'SDK story', fps: 10, canvas: { width: 160, height: 90 }, scenes: [{ id: 'import', keyMessage: 'Imported illustration', durationMs: 300, source: { kind: 'media', input, producer: 'Test fixture' } }] }))
      const ack = await client.callTool({ name: 'spectra_demo', arguments: { action: 'compose', storyPath, outDir } })
      expect(ack.isError, JSON.stringify(ack)).not.toBe(true)
      const statusText = () => JSON.parse((ack.content as Array<{text: string}>)[0].text)
      expect(statusText().jobId).toBeTruthy()
      expect(statusText().status).toBe('running')
      let status = statusText()
      for (let i=0; i<400 && status.status==='running'; i++) {
        await new Promise(r => setTimeout(r, 50))
        const result = await client.callTool({ name: 'spectra_demo', arguments: { action: 'compose-status', outDir } })
        expect(result.isError, JSON.stringify(result)).not.toBe(true)
        status = JSON.parse((result.content as Array<{text:string}>)[0].text)
      }
      expect(status.status, status.error).toBe('completed')
      expect(status.result.frames).toBe(3)
      // CLI test uses the compiled artifact and this isolated daemon; no installed daemon/auth is touched.
      const previous = process.env.SPECTRA_DAEMON_SOCKET
      process.env.SPECTRA_DAEMON_SOCKET = socketPath
      try {
        const cli = await runProcess(process.execPath, ['dist/cli/index.js', 'demo', JSON.stringify({ action: 'compose-status', outDir })])
        expect(JSON.parse(cli).jobId).toBe(status.jobId)
      } finally { if (previous === undefined) delete process.env.SPECTRA_DAEMON_SOCKET; else process.env.SPECTRA_DAEMON_SOCKET = previous }
    } finally {
      await client.close(); await server.close(); await daemon.close(); await api.close?.(); await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
