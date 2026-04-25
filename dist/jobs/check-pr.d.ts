import type { Job } from 'bullmq';
import type { CheckPrJobData } from '../types/index.js';
export declare function runCheckPrWork(job: Job<CheckPrJobData>): Promise<string>;
export declare function runCheckPrFlow(job: Job<CheckPrJobData>): Promise<void>;
export declare const processCheckPr: typeof runCheckPrFlow;
export declare const checkPrHandler: typeof runCheckPrFlow;
