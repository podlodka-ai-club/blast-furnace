import type { RepositoryIdentity, RunStatusMetadata } from '../types/index.js';
export interface RenderStatusCommentInput {
    runId: string;
    repository: RepositoryIdentity;
    issueNumber: number;
    status: RunStatusMetadata;
}
export declare function renderStatusComment(input: RenderStatusCommentInput): string;
