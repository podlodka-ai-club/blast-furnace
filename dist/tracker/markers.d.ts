import type { TrackerCommentKind } from '../types/index.js';
export interface TrackerCommentMarker {
    kind: TrackerCommentKind;
    runId: string;
    owner: string;
    repo: string;
    issue: number;
}
export declare function renderTrackerCommentMarker(marker: TrackerCommentMarker): string;
export declare function parseTrackerCommentMarker(line: string): TrackerCommentMarker | null;
export declare function extractSingleTrackerMarker(body: string): TrackerCommentMarker | null;
export declare function markerMatches(actual: TrackerCommentMarker | null, expected: TrackerCommentMarker): boolean;
