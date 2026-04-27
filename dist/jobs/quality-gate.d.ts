import type { Job } from 'bullmq';
import type { QualityGateJobData, ReviewJobData } from '../types/index.js';
export declare function runQualityGateWork(job: Job<QualityGateJobData>): Promise<ReviewJobData>;
export declare function runQualityGateFlow(job: Job<QualityGateJobData>): Promise<void>;
export declare const qualityGateHandler: typeof runQualityGateFlow;
