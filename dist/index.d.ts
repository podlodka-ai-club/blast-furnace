import type { Job } from 'bullmq';
import type { JobPayload } from './types/index.js';
export declare function multiHandler(job: Job<JobPayload>): Promise<void>;
