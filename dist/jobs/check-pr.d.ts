import type { Job } from 'bullmq';
import type { CheckPrJobData } from '../types/index.js';
export declare function processCheckPr(job: Job<CheckPrJobData>): Promise<void>;
export declare const checkPrHandler: typeof processCheckPr;
