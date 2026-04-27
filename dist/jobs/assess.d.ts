import type { Job } from 'bullmq';
import type { AssessJobData, PlanJobData } from '../types/index.js';
export declare function runAssessWork(job: Job<AssessJobData>): Promise<PlanJobData>;
export declare function runAssessFlow(job: Job<AssessJobData>): Promise<void>;
export declare const assessHandler: typeof runAssessFlow;
