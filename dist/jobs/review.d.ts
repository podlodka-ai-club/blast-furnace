import type { Job } from 'bullmq';
import type { MakePrJobData, ReviewJobData } from '../types/index.js';
export declare function runReviewWork(job: Job<ReviewJobData>): Promise<MakePrJobData>;
export declare function runReviewFlow(job: Job<ReviewJobData>): Promise<void>;
export declare const processReview: typeof runReviewFlow;
export declare const reviewHandler: typeof runReviewFlow;
