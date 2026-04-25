import type { Job } from 'bullmq';
import type { IssueWatcherJobData } from '../types/index.js';
export declare const REPO_LIST_KEY = "github:repos";
export declare function startIssueWatcher(): Promise<void>;
export declare function issueWatcherHandler(_job: Job<IssueWatcherJobData>): Promise<void>;
export declare function closeIssueWatcherRedis(): Promise<void>;
