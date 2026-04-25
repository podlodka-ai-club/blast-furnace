import type { Job } from 'bullmq';
import type { CodexProviderJobData, ReviewJobData } from '../types/index.js';
interface CodexWorkState {
    repoCwd: string | null;
}
export declare function runCodexWork(job: Job<CodexProviderJobData>, logger?: import("./logger.js").JobLogger, state?: CodexWorkState): Promise<ReviewJobData>;
export declare function runCodexFlow(job: Job<CodexProviderJobData>): Promise<void>;
export declare const processCodex: typeof runCodexFlow;
export declare const codexProviderHandler: typeof runCodexFlow;
export {};
