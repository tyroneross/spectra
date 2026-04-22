import { readFile } from 'node:fs/promises';
export async function parseCast(filePath) {
    const raw = await readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) {
        throw new Error(`Cast file is empty: ${filePath}`);
    }
    const header = JSON.parse(lines[0]);
    const events = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line)
            continue;
        let tuple;
        try {
            tuple = JSON.parse(line);
        }
        catch {
            console.warn(`[parser] skipping malformed line ${i + 1}: ${line.slice(0, 80)}`);
            continue;
        }
        const [time, rawType, data] = tuple;
        events.push({
            time,
            type: rawType === 'i' ? 'input' : 'output',
            data,
        });
    }
    const duration = events.length > 0 ? events[events.length - 1].time : 0;
    return { header, events, duration };
}
export function searchCast(cast, pattern) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return cast.events.filter(e => regex.test(e.data));
}
export function extractCommands(cast) {
    return cast.events
        .filter(e => e.type === 'input')
        .map(e => e.data.replace(/\r?\n$/, '').trim())
        .filter(cmd => cmd.length > 0);
}
export function formatCastSummary(cast) {
    const { header, events, duration } = cast;
    const outputEvents = events.filter(e => e.type === 'output');
    const totalChars = outputEvents.reduce((sum, e) => sum + e.data.length, 0);
    const firstOutput = outputEvents[0]?.data.slice(0, 80).replace(/\r?\n/g, ' ').trim() ?? '(none)';
    const lastOutput = outputEvents[outputEvents.length - 1]?.data.slice(0, 80).replace(/\r?\n/g, ' ').trim() ?? '(none)';
    const recorded = header.timestamp
        ? new Date(header.timestamp * 1000).toISOString()
        : 'unknown';
    return [
        `Recorded: ${recorded}`,
        `Terminal: ${header.width}x${header.height}`,
        `Duration: ${duration.toFixed(2)}s`,
        `Events: ${events.length} (${outputEvents.length} output, ${events.length - outputEvents.length} input)`,
        `Output size: ${(totalChars / 1024).toFixed(1)} KB`,
        `First output: ${firstOutput}`,
        `Last output:  ${lastOutput}`,
    ].join('\n');
}
//# sourceMappingURL=parser.js.map