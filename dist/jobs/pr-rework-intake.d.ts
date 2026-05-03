import type { Job } from 'bullmq';
import type { PrReworkIntakeJobData } from '../types/index.js';
export declare const PR_REWORK_INTAKE_PROMPT_TEMPLATE_PATH: string;
export interface PrReworkIntakeDependencies {
    analyzeRoute?(prompt: string): Promise<string>;
}
export interface PrReworkRoutePromptInput {
    issueTitle: string;
    issueDescription: string;
    latestPlanContent: string;
    commentsMarkdown: string;
}
export declare function renderPrReworkRoutePrompt(templatePath: string, input: PrReworkRoutePromptInput): Promise<string>;
export declare function runPrReworkIntakeWork(job: Job<PrReworkIntakeJobData>, dependencies?: PrReworkIntakeDependencies): Promise<void>;
export declare function prReworkIntakeHandler(job: Job<PrReworkIntakeJobData>): Promise<void>;
