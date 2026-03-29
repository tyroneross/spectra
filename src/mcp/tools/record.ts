import { multiRecord } from '../../terminal/multi-recorder.js'
import { parseCast, searchCast, extractCommands, formatCastSummary } from '../../terminal/parser.js'

export interface RecordParams {
  command: string
  timeout?: number
  watch_files?: string[]
  outputDir?: string
}

export interface RecordToolResult {
  castFile?: string
  exitCode?: number
  duration: number
  outputSize?: number
  lines?: number
  fileChanges: number
  timeline: Array<{ time: number; source: string; event: string }>
}

export async function handleRecord(params: RecordParams): Promise<RecordToolResult> {
  const result = await multiRecord({
    command: params.command,
    captureTerminal: true,
    captureFiles: params.watch_files && params.watch_files.length > 0
      ? { watch: params.watch_files }
      : undefined,
    maxDuration: params.timeout,
    outputDir: params.outputDir,
  })

  return {
    castFile: result.terminal?.castFile,
    exitCode: result.terminal?.exitCode,
    duration: result.duration,
    outputSize: result.terminal?.outputSize,
    lines: result.terminal?.lines,
    fileChanges: result.fileChanges.length,
    timeline: result.timeline,
  }
}

export interface ReplayParams {
  file: string
  search?: string
  commands_only?: boolean
}

export interface ReplayToolResult {
  summary: string
  events?: Array<{ time: number; type: string; data: string }>
  commands?: string[]
  matchCount?: number
}

export async function handleReplay(params: ReplayParams): Promise<ReplayToolResult> {
  const cast = await parseCast(params.file)
  const summary = formatCastSummary(cast)

  if (params.commands_only) {
    const commands = extractCommands(cast)
    return { summary, commands }
  }

  if (params.search) {
    const matched = searchCast(cast, params.search)
    return {
      summary,
      events: matched.map(e => ({ time: e.time, type: e.type, data: e.data })),
      matchCount: matched.length,
    }
  }

  // Default: return summary + first 50 events
  return {
    summary,
    events: cast.events.slice(0, 50).map(e => ({ time: e.time, type: e.type, data: e.data })),
  }
}
