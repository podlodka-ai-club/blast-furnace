import type { Job } from 'bullmq';
import type { DevelopJobData, QualityGateJobData } from '../types/index.js';
export declare function runDevelopWork(job: Job<DevelopJobData>, logger?: import("./logger.js").JobLogger): Promise<QualityGateJobData>;
export declare function runDevelopFlow(job: Job<DevelopJobData>): Promise<void>;
export declare const processDevelop: typeof runDevelopFlow;
export declare const developHandler: typeof runDevelopFlow;
