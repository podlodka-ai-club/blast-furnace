import type { Job } from 'bullmq';
import type { MakePrJobData, NoChangeOutput, PullRequestCreationFailureOutput, PullRequestOutput, SyncTrackerStateJobData } from '../types/index.js';
export type MakePrWorkResult = {
    status: 'no-changes';
    output: NoChangeOutput;
    workspacePath: string;
    syncTrackerStateJobData?: SyncTrackerStateJobData;
} | {
    status: PullRequestCreationFailureOutput['status'];
    output: PullRequestCreationFailureOutput;
} | {
    status: 'pull-request-created';
    output: PullRequestOutput;
    syncTrackerStateJobData: SyncTrackerStateJobData;
};
export declare function runMakePrWork(job: Job<MakePrJobData>, logger?: import("./logger.js").JobLogger): Promise<MakePrWorkResult>;
export declare function runMakePrFlow(job: Job<MakePrJobData>): Promise<void>;
export declare const processMakePr: typeof runMakePrFlow;
export declare const makePrHandler: typeof runMakePrFlow;
