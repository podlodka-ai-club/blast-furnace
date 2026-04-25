import type { Job } from 'bullmq';
import type { ReviewJobData } from '../types/index.js';
export declare function processReview(job: Job<ReviewJobData>): Promise<void>;
export declare const reviewHandler: typeof processReview;
