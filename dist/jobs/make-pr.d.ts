import type { Job } from 'bullmq';
import type { MakePrJobData } from '../types/index.js';
export declare function processMakePr(job: Job<MakePrJobData>): Promise<void>;
export declare const makePrHandler: typeof processMakePr;
