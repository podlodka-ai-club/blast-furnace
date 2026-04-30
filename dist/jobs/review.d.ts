import type { Job } from 'bullmq';
import type { DevelopJobData, MakePrJobData, ReviewJobData, ReviewOutput } from '../types/index.js';
export declare const REVIEW_PROMPT_TEMPLATE_PATH: string;
export declare const REVIEW_REPAIR_PROMPT_TEMPLATE_PATH: string;
export type ParsedReviewResponse = {
    status: 'success';
} | {
    status: 'failed';
    content: string;
} | {
    status: 'malformed';
    rawResponse: string;
};
export type ReviewWorkResult = {
    status: 'success';
    output: ReviewOutput;
    makePrJobData: MakePrJobData;
} | {
    status: 'review-failed';
    output: ReviewOutput;
    developJobData: DevelopJobData;
} | {
    status: 'review-malformed' | 'review-exhausted';
    output: ReviewOutput;
};
export declare function parseReviewResponse(response: string): ParsedReviewResponse;
export declare function runReviewWork(job: Job<ReviewJobData>, logger?: import("./logger.js").JobLogger): Promise<ReviewWorkResult>;
export declare function runReviewFlow(job: Job<ReviewJobData>): Promise<void>;
export declare const processReview: typeof runReviewFlow;
export declare const reviewHandler: typeof runReviewFlow;
