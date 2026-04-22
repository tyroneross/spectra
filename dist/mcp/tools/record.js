import { multiRecord } from '../../terminal/multi-recorder.js';
import { parseCast, searchCast, extractCommands, formatCastSummary } from '../../terminal/parser.js';
export async function handleRecord(params) {
    const result = await multiRecord({
        command: params.command,
        captureTerminal: true,
        captureFiles: params.watch_files && params.watch_files.length > 0
            ? { watch: params.watch_files }
            : undefined,
        maxDuration: params.timeout,
        outputDir: params.outputDir,
    });
    return {
        castFile: result.terminal?.castFile,
        exitCode: result.terminal?.exitCode,
        duration: result.duration,
        outputSize: result.terminal?.outputSize,
        lines: result.terminal?.lines,
        fileChanges: result.fileChanges.length,
        timeline: result.timeline,
    };
}
export async function handleReplay(params) {
    const cast = await parseCast(params.file);
    const summary = formatCastSummary(cast);
    if (params.commands_only) {
        const commands = extractCommands(cast);
        return { summary, commands };
    }
    if (params.search) {
        const matched = searchCast(cast, params.search);
        return {
            summary,
            events: matched.map(e => ({ time: e.time, type: e.type, data: e.data })),
            matchCount: matched.length,
        };
    }
    // Default: return summary + first 50 events
    return {
        summary,
        events: cast.events.slice(0, 50).map(e => ({ time: e.time, type: e.type, data: e.data })),
    };
}
//# sourceMappingURL=record.js.map