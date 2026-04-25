import type { Job } from 'bullmq';
import type { IssueProcessorJobData, PlanJobData } from '../types/index.js';
export declare function runIssueProcessorWork(job: Job<IssueProcessorJobData>, logger?: import("./logger.js").JobLogger): Promise<PlanJobData>;
export declare function runIssueProcessorFlow(job: Job<IssueProcessorJobData>): Promise<void>;
export declare const processIssue: typeof runIssueProcessorFlow;
export declare const issueProcessorHandler: typeof runIssueProcessorFlow;
