import type { RunStatusMetadata, StatusChecklistItem, StatusItemStage, StatusItemState } from '../types/index.js';
import { type TrackerClient } from '../tracker/github.js';
export interface StatusLogger {
    warn(message: string): void;
}
export interface RunStatusUpdate {
    heading?: string;
    focus?: string;
    note?: string;
    items?: StatusChecklistItem[];
}
export declare function updateRunStatus(root: string, runId: string, update: RunStatusUpdate, logger?: StatusLogger, client?: TrackerClient): Promise<RunStatusMetadata | null>;
export declare function statusItem(stage: StatusItemStage, attempt: number, state: StatusItemState, label: string, detail?: string): StatusChecklistItem;
export declare function developStatusItem(attempt: number, state: StatusItemState, detail?: string): StatusChecklistItem;
export declare function qualityStatusItem(attempt: number, state: StatusItemState, detail?: string): StatusChecklistItem;
export declare function reviewStatusItem(attempt: number, state: StatusItemState, detail?: string): StatusChecklistItem;
