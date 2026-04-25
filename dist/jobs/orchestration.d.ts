import type { ArtifactLocation, ArtifactMetadata, EventMetadata, JobPayload, RunId, RunSummaryData, StageAttemptLocation } from '../types/index.js';
export interface QueueLike {
    add(name: string, data: JobPayload): Promise<unknown>;
}
export declare function resolveRunDirectory(root: string, runId: RunId): string;
export declare function resolveStageAttemptDirectory(root: string, location: StageAttemptLocation): string;
export declare function resolveArtifactPath(root: string, location: ArtifactLocation): string;
export declare function resolveEventPath(root: string, runId: RunId, eventName: string): string;
export declare function resolveRunSummaryPath(root: string, runId: RunId): string;
export declare function writeArtifactFile(root: string, location: ArtifactLocation, data: unknown): Promise<ArtifactMetadata>;
export declare function writeEventFile(root: string, runId: RunId, eventName: string, data: unknown): Promise<EventMetadata>;
export declare function readRunSummary(root: string, runId: RunId): Promise<RunSummaryData | null>;
export declare function writeRunSummary(root: string, summary: RunSummaryData): Promise<void>;
export declare function updateRunSummary(root: string, runId: RunId, update: (summary: RunSummaryData) => RunSummaryData): Promise<RunSummaryData>;
export declare function scheduleNextJob<TData extends JobPayload>(queue: QueueLike, jobName: TData['type'], data: TData): Promise<unknown>;
