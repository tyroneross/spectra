import { type StoryInput } from './story-schema.js';
export interface StoryResult {
    outPath: string;
    manifestPath: string;
    captionsPath: string;
    contactSheet: string;
    poster: string;
    strips: string[];
    width: number;
    height: number;
    fps: number;
    frames: number;
    durationMs: number;
}
export interface StoryStatus {
    ownerPid: number;
    jobId: string;
    status: 'running' | 'completed' | 'failed' | 'interrupted';
    outDir: string;
    completedScenes: number;
    totalScenes: number;
    startedAt: string;
    result?: StoryResult;
    error?: string;
}
export declare function getStoryStatus(outDir: string): Promise<StoryStatus>;
export declare function stopStoryJobs(): Promise<void>;
/** Returns after the editable input and running status are durable, before rendering. */
export declare function startStoryJob(storyPath: string, outDir: string): Promise<StoryStatus>;
export declare function composeStory(input: StoryInput, outDir: string): Promise<StoryResult>;
//# sourceMappingURL=story.d.ts.map