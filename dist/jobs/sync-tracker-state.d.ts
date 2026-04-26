import type { Job } from 'bullmq';
import type { SyncTrackerStateJobData } from '../types/index.js';
export declare function runSyncTrackerStateWork(job: Job<SyncTrackerStateJobData>, logger?: import("./logger.js").JobLogger): Promise<SyncTrackerStateJobData['pullRequest']>;
export declare function runSyncTrackerStateFlow(job: Job<SyncTrackerStateJobData>): Promise<void>;
export declare const syncTrackerStateHandler: typeof runSyncTrackerStateFlow;
