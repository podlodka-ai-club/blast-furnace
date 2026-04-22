import type { Job } from 'bullmq';
import type { IssueProcessorJobData } from '../types/index.js';
export declare function processIssue(job: Job<IssueProcessorJobData>): Promise<void>;
export declare const issueProcessorHandler: typeof processIssue;
