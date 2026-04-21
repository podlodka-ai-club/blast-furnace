import { Queue, QueueEvents } from 'bullmq';
import type { JobPayload } from '../types/index.js';
export type JobData = JobPayload;
export declare const jobQueue: Queue<JobPayload, any, string, JobPayload, any, string>;
export declare const queueEvents: QueueEvents;
export declare function closeQueue(): Promise<void>;
