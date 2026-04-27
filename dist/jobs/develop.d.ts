import type { Job } from 'bullmq';
import type { DevelopJobData, DevelopOutput, ReviewJobData } from '../types/index.js';
export interface DevelopWorkResult {
    output: DevelopOutput;
    reviewJobData?: ReviewJobData;
}
export declare function buildCodexCliArgs(cliCmd: string, cliArgs: string[], prompt: string, model: string): string[];
export declare function runDevelopWork(job: Job<DevelopJobData>, logger?: import("./logger.js").JobLogger): Promise<DevelopWorkResult>;
export declare function runDevelopFlow(job: Job<DevelopJobData>): Promise<void>;
export declare const processDevelop: typeof runDevelopFlow;
export declare const developHandler: typeof runDevelopFlow;
