import type { Job } from 'bullmq';
import type { MakePrJobData, SyncTrackerStateJobData } from '../types/index.js';
export type MakePrWorkResult = {
    status: 'no-changes';
} | {
    status: 'pull-request-created';
    pullRequest: SyncTrackerStateJobData['pullRequest'];
};
export declare function runMakePrWork(job: Job<MakePrJobData>, logger?: import("./logger.js").JobLogger): Promise<MakePrWorkResult>;
export declare function runMakePrFlow(job: Job<MakePrJobData>): Promise<void>;
export declare const processMakePr: typeof runMakePrFlow;
export declare const makePrHandler: typeof runMakePrFlow;
