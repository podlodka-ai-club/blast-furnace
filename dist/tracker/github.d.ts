import type { RepositoryIdentity, RunStatusMetadata } from '../types/index.js';
export interface CreateOrUpdateStatusCommentInput {
    runId: string;
    issueNumber: number;
    repository: RepositoryIdentity;
    status: RunStatusMetadata;
}
export interface TrackerClient {
    createOrUpdateStatusComment(input: CreateOrUpdateStatusCommentInput): Promise<RunStatusMetadata>;
}
export declare class GitHubTrackerClient implements TrackerClient {
    createOrUpdateStatusComment(input: CreateOrUpdateStatusCommentInput): Promise<RunStatusMetadata>;
}
export declare const trackerClient: TrackerClient;
