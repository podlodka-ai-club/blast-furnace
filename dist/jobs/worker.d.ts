import { Worker, Job } from 'bullmq';
import type { JobPayload } from '../types/index.js';
export interface WorkerOptions {
    concurrency?: number;
}
export declare function createWorker(processor: (job: Job<JobPayload>) => Promise<void>, options?: WorkerOptions): Worker<JobPayload>;
export declare function closeWorker(worker: Worker<JobPayload>): Promise<void>;
