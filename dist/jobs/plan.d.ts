import type { Job } from 'bullmq';
import type { DevelopJobData, GitHubIssue, PlanJobData, PlanOutput } from '../types/index.js';
import { createJobLogger } from './logger.js';
export declare const PLAN_PROMPT_TEMPLATE_PATH: string;
export declare const PLAN_REWORK_PROMPT_TEMPLATE_PATH: string;
export declare const PLAN_CHECKS_PATH: string;
export declare const PLAN_CONTINUATION_PROMPT: string;
export interface PlanChecks {
    requiredTitles: string[];
}
export interface PlanResponseValidation {
    passed: boolean;
    missingTitles: string[];
    failureReason?: string;
}
export interface PlanPromptInput {
    issue: Pick<GitHubIssue, 'number' | 'title' | 'body'>;
    latestPlanContent?: string;
    commentsMarkdown?: string;
}
export interface PlanningSession {
    send(prompt: string): Promise<string>;
    close?(): Promise<void>;
}
export interface PlanRunOptions {
    promptTemplatePath?: string;
    checksPath?: string;
    createPlanningSession?: (input: {
        workspacePath: string;
        logger: ReturnType<typeof createJobLogger>;
    }) => Promise<PlanningSession>;
}
export interface PlanWorkResult {
    output: PlanOutput;
    developJobData?: DevelopJobData;
}
export declare function renderPlanPrompt(templatePath: string, input: PlanPromptInput): Promise<string>;
export declare function loadPlanChecks(checksPath: string): Promise<PlanChecks>;
export declare function validatePlanResponse(content: string, checks: PlanChecks): PlanResponseValidation;
export declare function runPlanWork(job: Job<PlanJobData>, options?: PlanRunOptions): Promise<PlanWorkResult>;
export declare function runPlanFlow(job: Job<PlanJobData>, options?: PlanRunOptions): Promise<void>;
export declare const processPlan: typeof runPlanFlow;
export declare const planHandler: typeof runPlanFlow;
