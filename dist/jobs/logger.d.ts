import { Job } from 'bullmq';
import type { JobPayload } from '../types/index.js';
export interface JobLogger {
    info(message: string): void;
    error(message: string): void;
    warn(message: string): void;
    debug(message: string): void;
}
export declare function createJobLogger(job: Job<JobPayload>): JobLogger;
