import type { Job } from 'bullmq';
import type { DevelopJobData, PlanJobData } from '../types/index.js';
export declare function runPlanWork(job: Job<PlanJobData>): Promise<DevelopJobData>;
export declare function runPlanFlow(job: Job<PlanJobData>): Promise<void>;
export declare const processPlan: typeof runPlanFlow;
export declare const planHandler: typeof runPlanFlow;
