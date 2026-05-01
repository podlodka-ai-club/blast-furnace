import type { RunStatusMetadata, StatusChecklistItem, StatusItemStage, StatusItemState } from '../types/index.js';
export declare function statusItemId(stage: StatusItemStage, attempt: number): string;
export declare function createInitialStatusMetadata(now: string): RunStatusMetadata;
export declare function upsertStatusItems(checklist: StatusChecklistItem[], updates: StatusChecklistItem[]): StatusChecklistItem[];
export declare function makeStatusItem(stage: StatusItemStage, attempt: number, state: StatusItemState, label: string, detail?: string): StatusChecklistItem;
export declare function statusIcon(state: StatusItemState): string;
