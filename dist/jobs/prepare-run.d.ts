import type { Job } from 'bullmq';
import type { AssessJobData, GitHubIssue, PrepareRunJobData, RepositoryIdentity } from '../types/index.js';
interface PrepareRunState {
    branchName: string | null;
    branchCreated: boolean;
    workspacePath: string | null;
    cleaned: boolean;
}
export interface PrepareRunWorkResult {
    assessJobData: AssessJobData;
    runLogPath: string;
}
export interface CreatePrepareRunPayloadInput {
    issue: GitHubIssue;
    repository: RepositoryIdentity;
    taskId?: string;
    runId?: string;
}
export declare function createPrepareRunPayload(input: CreatePrepareRunPayloadInput): PrepareRunJobData;
export declare function prepareIssueBranchName(issue: PrepareRunJobData['issue']): string;
export declare function runPrepareRunWork(job: Job<PrepareRunJobData>, logger?: import("./logger.js").JobLogger, state?: PrepareRunState): Promise<PrepareRunWorkResult>;
export declare function runPrepareRunFlow(job: Job<PrepareRunJobData>): Promise<void>;
export declare const prepareRunHandler: typeof runPrepareRunFlow;
export {};
