import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { recordTerminal } from './recorder.js'
import type { RecordResult, RecordOptions } from './recorder.js'

export interface MultiRecordOptions {
  command: string
  captureTerminal?: boolean       // Default true
  captureFiles?: { watch: string[] }
  outputDir?: string
  maxDuration?: number
  cols?: number
  rows?: number
  env?: Record<string, string>
  cwd?: string
}

export interface FileChange {
  path: string
  type: 'added' | 'modified' | 'deleted'
  timestamp: number
}

export interface TimelineEvent {
  time: number       // Seconds elapsed
  source: 'terminal' | 'file'
  event: string      // Description
}

export interface MultiRecordResult {
  terminal?: RecordResult
  fileChanges: FileChange[]
  timeline: TimelineEvent[]
  duration: number
}

export async function multiRecord(options: MultiRecordOptions): Promise<MultiRecordResult> {
  const {
    command,
    captureTerminal = true,
    captureFiles,
    outputDir,
    maxDuration = 300_000,
    cols,
    rows,
    env,
    cwd,
  } = options

  const startTime = performance.now()
  const fileChanges: FileChange[] = []
  const timeline: TimelineEvent[] = []
  const watchers: FSWatcher[] = []

  function elapsed(): number {
    return (performance.now() - startTime) / 1000
  }

  // Set up file watchers before starting the terminal
  if (captureFiles?.watch && captureFiles.watch.length > 0) {
    for (const watchPath of captureFiles.watch) {
      try {
        const watcher = watch(watchPath, { persistent: false }, (eventType, filename) => {
          const now = performance.now()
          const time = (now - startTime) / 1000
          const changeType: FileChange['type'] = eventType === 'rename' ? 'added' : 'modified'
          const resolvedPath = filename ? `${watchPath}/${filename}` : watchPath

          const change: FileChange = {
            path: resolvedPath,
            type: changeType,
            timestamp: Date.now(),
          }
          fileChanges.push(change)

          const event: TimelineEvent = {
            time,
            source: 'file',
            event: `${changeType}: ${resolvedPath}`,
          }
          timeline.push(event)
        })

        watcher.on('error', (err) => {
          console.warn(`[multi-recorder] watcher error for ${watchPath}: ${err.message}`)
        })

        watchers.push(watcher)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[multi-recorder] could not watch ${watchPath}: ${msg}`)
      }
    }
  }

  // Add terminal start event
  timeline.push({
    time: elapsed(),
    source: 'terminal',
    event: `started: ${command}`,
  })

  let terminalResult: RecordResult | undefined

  try {
    if (captureTerminal) {
      const recordOptions: RecordOptions = {
        command,
        maxDuration,
        cols,
        rows,
        env,
        cwd,
      }

      if (outputDir) {
        const timestamp = Date.now()
        recordOptions.outputPath = `${outputDir}/${timestamp}.cast`
      }

      terminalResult = await recordTerminal(recordOptions)

      timeline.push({
        time: elapsed(),
        source: 'terminal',
        event: `exited with code ${terminalResult.exitCode} after ${terminalResult.duration.toFixed(2)}s`,
      })
    }
  } finally {
    // Stop all file watchers
    for (const watcher of watchers) {
      try {
        watcher.close()
      } catch {
        // ignore close errors
      }
    }
  }

  // Sort timeline by time
  timeline.sort((a, b) => a.time - b.time)

  const duration = (performance.now() - startTime) / 1000

  return {
    terminal: terminalResult,
    fileChanges,
    timeline,
    duration,
  }
}
