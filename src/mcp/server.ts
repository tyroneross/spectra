import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createContext } from './context.js'
import { handleConnect } from './tools/connect.js'
import { handleSnapshot } from './tools/snapshot.js'
import { handleAct } from './tools/act.js'
import { handleStep } from './tools/step.js'
import { handleCapture } from './tools/capture.js'
import { handleSession } from './tools/session.js'
import { handleAnalyze } from './tools/analyze.js'
import { handleDiscover } from './tools/discover.js'

const ctx = createContext()

const server = new McpServer({
  name: 'spectra',
  version: '0.1.0',
})

server.tool(
  'spectra_connect',
  'Start a new UI automation session. Target: URL (web), app name (macOS), sim:device (iOS/watchOS).',
  {
    target: z.string().describe('URL, app name, or sim:device identifier'),
    name: z.string().optional().describe('Human-readable session name'),
    record: z.boolean().optional().describe('Start video recording'),
  },
  async ({ target, name, record }) => {
    const result = await handleConnect({ target, name, record }, ctx)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'spectra_snapshot',
  'Get current AX tree snapshot of the active session.',
  {
    sessionId: z.string().describe('Session ID'),
    screenshot: z.boolean().optional().describe('Include screenshot'),
  },
  async ({ sessionId, screenshot }) => {
    const result = await handleSnapshot({ sessionId, screenshot }, ctx)
    return { content: [{ type: 'text' as const, text: result.snapshot }] }
  },
)

server.tool(
  'spectra_act',
  'Perform an action on an element (click, type, clear, scroll, hover, focus).',
  {
    sessionId: z.string(),
    elementId: z.string().describe('Element ID from snapshot (e.g., "e4")'),
    action: z.enum(['click', 'type', 'clear', 'select', 'scroll', 'hover', 'focus']),
    value: z.string().optional().describe('Text to type or scroll amount'),
  },
  async ({ sessionId, elementId, action, value }) => {
    const result = await handleAct({ sessionId, elementId, action, value }, ctx)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'spectra_step',
  'Natural language step: describe what to do, Spectra finds the element and optionally executes.',
  {
    sessionId: z.string(),
    intent: z.string().describe('What to do, e.g., "click the Log In button"'),
  },
  async ({ sessionId, intent }) => {
    const result = await handleStep({ sessionId, intent }, ctx)
    const { screenshot, ...textResult } = result
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
      { type: 'text' as const, text: JSON.stringify(textResult, null, 2) },
    ]
    if (screenshot) {
      content.push({ type: 'image' as const, data: screenshot, mimeType: 'image/png' })
    }
    return { content }
  },
)

server.tool(
  'spectra_capture',
  'Capture screenshot or manage video recording. Supports intelligent framing modes: full, element, region, auto.',
  {
    sessionId: z.string(),
    type: z.enum(['screenshot', 'start_recording', 'stop_recording']),
    mode: z.enum(['full', 'element', 'region', 'auto']).optional().describe('Capture mode (default: full)'),
    elementId: z.string().optional().describe('Element ID for mode=element'),
    region: z.string().optional().describe('Region label for mode=region (e.g., "Navigation", "Form")'),
    aspectRatio: z.string().optional().describe('Output aspect ratio e.g. "16:9", "4:3", "1:1"'),
    clean: z.boolean().optional().describe('Apply visual cleanup before capture (default: true)'),
    quality: z.enum(['lossless', 'high', 'medium']).optional().describe('Output quality'),
  },
  async ({ sessionId, type, mode, elementId, region, aspectRatio, clean, quality }) => {
    const result = await handleCapture({ sessionId, type, mode, elementId, region, aspectRatio, clean, quality }, ctx)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'spectra_analyze',
  'Score the current screen and identify regions of interest, UI state, and top elements by importance',
  {
    sessionId: z.string().describe('Active session ID'),
    viewport: z.object({
      width: z.number(),
      height: z.number(),
      devicePixelRatio: z.number().optional(),
    }).optional().describe('Viewport dimensions for scoring (defaults: 1280x800@1x)'),
  },
  async ({ sessionId, viewport }) => {
    const result = await handleAnalyze({ sessionId, viewport }, ctx)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'spectra_discover',
  'Auto-navigate and capture an entire app — discovers screens via BFS crawl, scores elements, detects UI states, and produces framed screenshots',
  {
    sessionId: z.string().describe('Active session ID'),
    maxDepth: z.number().optional().describe('Max navigation depth (default: 3)'),
    maxScreens: z.number().optional().describe('Max screens to discover (default: 50)'),
    captureStates: z.boolean().optional().describe('Capture loading/error/empty states (default: false)'),
    clean: z.boolean().optional().describe('Apply visual cleanup before capture (default: true)'),
    outputDir: z.string().optional().describe('Custom output directory'),
  },
  async ({ sessionId, maxDepth, maxScreens, captureStates, clean, outputDir }) => {
    const result = await handleDiscover({ sessionId, maxDepth, maxScreens, captureStates, clean, outputDir }, ctx)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'spectra_session',
  'List, get, close, or close all sessions.',
  {
    action: z.enum(['list', 'get', 'close', 'close_all']),
    sessionId: z.string().optional(),
  },
  async ({ action, sessionId }) => {
    const result = await handleSession({ action, sessionId }, ctx)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
