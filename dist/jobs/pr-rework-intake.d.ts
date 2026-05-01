import type { Job } from 'bullmq';
import type { PrReworkIntakeJobData } from '../types/index.js';
export interface PrReworkIntakeDependencies {
    analyzeRoute?(prompt: string): Promise<string>;
}
export declare function runPrReworkIntakeWork(job: Job<PrReworkIntakeJobData>, dependencies?: PrReworkIntakeDependencies): Promise<void>;
export declare function prReworkIntakeHandler(job: Job<PrReworkIntakeJobData>): Promise<void>;
