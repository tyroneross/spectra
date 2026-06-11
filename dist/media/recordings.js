// src/media/recordings.ts
//
// In-memory registry of active video recordings keyed by sessionId.
// One recording per session at a time. Stop is idempotent.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { startRecording, encodeRecording, resolveVideoOptions } from './pipeline.js';
/**
 * Singleton registry. The daemon process owns one of these; HTTP requests
 * across multiple connections share state via this module.
 */
class RecordingRegistry {
    records = new Map(); // sessionId → record
    starting = new Set();
    has(sessionId) {
        return this.records.has(sessionId);
    }
    list() {
        return [...this.records.values()];
    }
    async start(opts) {
        const existing = this.records.get(opts.sessionId);
        if (this.starting.has(opts.sessionId) || (existing && !existing.stopped)) {
            throw new Error(`Recording already active for session ${opts.sessionId}`);
        }
        this.starting.add(opts.sessionId);
        try {
            // Resolve effective options now so we can return them deterministically
            const effective = resolveVideoOptions(opts.options);
            const handle = await startRecording(opts.platform, opts.outputDir, effective);
            const record = {
                id: randomUUID().slice(0, 8),
                sessionId: opts.sessionId,
                handle,
                rawPath: '', // populated on stop
                startedAt: Date.now(),
                options: effective,
                stopped: false,
            };
            this.records.set(opts.sessionId, record);
            return {
                recordingId: record.id,
                startedAt: record.startedAt,
                options: effective,
            };
        }
        finally {
            this.starting.delete(opts.sessionId);
        }
    }
    async stop(opts) {
        const record = this.records.get(opts.sessionId);
        if (!record) {
            throw new Error(`No active recording for session ${opts.sessionId}`);
        }
        if (record.stopped && record.lastResult) {
            // Idempotent second stop
            const r = record.lastResult;
            return {
                recordingId: record.id,
                path: r.path,
                durationMs: Math.max(0, (record.lastResult ? r.duration * 1000 : 0)),
                sizeBytes: r.size,
                codec: r.codec,
                fps: r.fps,
                width: r.width,
                height: r.height,
                droppedFrames: r.droppedFrames,
                alreadyStopped: true,
            };
        }
        const rawPath = await record.handle.stop();
        record.rawPath = rawPath;
        record.stopped = true;
        const stoppedAt = Date.now();
        const durationMs = stoppedAt - record.startedAt;
        // Encode for distribution. For now we keep stderr buffering inside pipeline.encodeRecording;
        // dropped-frame parsing surfaced as 0 by default until pipeline returns it.
        const encoded = await encodeRecording(rawPath, opts.outputDir, record.options);
        const effectiveDurationMs = encoded.duration > 0
            ? Math.round(encoded.duration * 1000)
            : durationMs;
        // Sanity-check encoded file exists and matches reported size
        try {
            const s = await stat(encoded.path);
            if (s.size !== encoded.size)
                encoded.size = s.size;
        }
        catch {
            // best-effort: leave reported size
        }
        record.lastResult = { ...encoded, duration: effectiveDurationMs / 1000 };
        // Keep record around for idempotent second stop and "alreadyStopped" semantics
        return {
            recordingId: record.id,
            path: encoded.path,
            durationMs: effectiveDurationMs,
            sizeBytes: encoded.size,
            codec: encoded.codec,
            fps: encoded.fps,
            width: encoded.width,
            height: encoded.height,
            droppedFrames: undefined, // ffmpeg drop-frame parsing tracked in C7
            alreadyStopped: false,
        };
    }
    /** Forget a stopped recording (called by close-session). */
    forget(sessionId) {
        this.records.delete(sessionId);
    }
    /** Kill any active recording for a session without encoding (close-session shutdown). */
    async abort(sessionId) {
        const record = this.records.get(sessionId);
        if (!record)
            return;
        if (!record.stopped) {
            try {
                await record.handle.stop();
            }
            catch { /* best-effort */ }
            record.stopped = true;
        }
        this.records.delete(sessionId);
    }
    /** Test-only: reset the registry. */
    _reset() {
        this.records.clear();
        this.starting.clear();
    }
}
export const recordings = new RecordingRegistry();
//# sourceMappingURL=recordings.js.map