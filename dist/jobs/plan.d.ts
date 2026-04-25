import type { Job } from 'bullmq';
import type { PlanJobData } from '../types/index.js';
export declare function processPlan(job: Job<PlanJobData>): Promise<void>;
export declare const planHandler: typeof processPlan;
