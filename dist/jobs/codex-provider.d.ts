import type { Job } from 'bullmq';
import type { CodexProviderJobData } from '../types/index.js';
export declare function processCodex(job: Job<CodexProviderJobData>): Promise<void>;
export declare const codexProviderHandler: typeof processCodex;
