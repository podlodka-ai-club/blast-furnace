import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/index.js';
import { runCodexSession } from './codex-session.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { resolveReviewContext } from './context-resolvers.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { appendHandoffRecordAndUpdateSummary, resolveOrchestrationStorageRoot, scheduleNextJob, } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
export const REVIEW_PROMPT_TEMPLATE_PATH = join(process.cwd(), 'prompts', 'review.md');
export const REVIEW_REPAIR_PROMPT_TEMPLATE_PATH = join(process.cwd(), 'prompts', 'review-repair.md');
function parseReviewAttemptLimit(value, defaultValue) {
    if (value === undefined)
        return defaultValue;
    if (!/^\d+$/.test(value)) {
        throw new Error('REVIEW_ATTEMPT_LIMIT must be an integer from 1 through 19');
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 19) {
        throw new Error('REVIEW_ATTEMPT_LIMIT must be an integer from 1 through 19');
    }
    return parsed;
}
function reviewAttemptLimit() {
    return parseReviewAttemptLimit(process.env['REVIEW_ATTEMPT_LIMIT'], config.review?.attemptLimit ?? 3);
}
export function parseReviewResponse(response) {
    const trimmed = response.trim();
    if (trimmed === 'Review Success') {
        return { status: 'success' };
    }
    const lines = trimmed.split(/\r?\n/);
    if (lines[0] === 'Review failed') {
        const content = lines.slice(1).join('\n').trim();
        if (content.length > 0) {
            return { status: 'failed', content };
        }
    }
    return { status: 'malformed', rawResponse: response };
}
async function runReviewCodex(job, logger, workspacePath) {
    const prompt = await readFile(REVIEW_PROMPT_TEMPLATE_PATH, 'utf8');
    const first = await runCodexSession({
        prompt,
        workspacePath,
        logger,
        resumeLastSession: false,
        outputLastMessage: true,
        enableHooks: false,
        bypassSandbox: false,
        sandboxMode: 'read-only',
        codexExecSubcommand: 'review',
        logPrefix: 'review-codex',
        timeoutLabel: 'review codex process',
    });
    const parsed = parseReviewResponse(first.output);
    if (parsed.status !== 'malformed') {
        return first.output;
    }
    logger.warn(`Review response for run ${job.data.runId} was malformed; requesting repair`);
    const repairPrompt = await readFile(REVIEW_REPAIR_PROMPT_TEMPLATE_PATH, 'utf8');
    const repaired = await runCodexSession({
        prompt: repairPrompt,
        workspacePath,
        logger,
        resumeLastSession: true,
        outputLastMessage: true,
        enableHooks: false,
        bypassSandbox: false,
        sandboxMode: 'read-only',
        logPrefix: 'review-repair-codex',
        timeoutLabel: 'review repair codex process',
    });
    return repaired.output;
}
export async function runReviewWork(job, logger = createJobLogger(job)) {
    stagePayloadSchemas.review.parse(job.data);
    const context = await resolveReviewContext(job.data);
    const response = await runReviewCodex(job, logger, context.runContext.workspacePath);
    const parsed = parseReviewResponse(response);
    const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
    const dependsOn = [
        job.data.inputRecordRef,
        context.planRecord.recordId,
    ];
    if (parsed.status === 'success') {
        const output = stageOutputSchemas.review.parse({
            status: 'success',
            runId: job.data.runId,
            stageAttempt: job.data.stageAttempt,
            reworkAttempt: job.data.reworkAttempt,
            review: {
                status: 'passed',
                summary: 'Review Success',
            },
        });
        const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
            runId: job.data.runId,
            fromStage: 'review',
            toStage: 'make-pr',
            stageAttempt: job.data.stageAttempt,
            reworkAttempt: job.data.reworkAttempt,
            dependsOn,
            status: 'success',
            output,
        });
        return {
            status: 'success',
            output,
            makePrJobData: createForwardStagePayload(job.data, 'make-pr', inputRecordRef, job.data.stageAttempt),
        };
    }
    if (parsed.status === 'failed') {
        if (job.data.stageAttempt >= reviewAttemptLimit()) {
            const output = stageOutputSchemas.review.parse({
                status: 'review-exhausted',
                runId: job.data.runId,
                stageAttempt: job.data.stageAttempt,
                reworkAttempt: job.data.reworkAttempt,
                review: {
                    status: 'exhausted',
                    summary: 'Review failed and rework attempt limit was reached.',
                    content: parsed.content,
                },
            });
            await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
                runId: job.data.runId,
                fromStage: 'review',
                toStage: null,
                stageAttempt: job.data.stageAttempt,
                reworkAttempt: job.data.reworkAttempt,
                dependsOn,
                status: 'failure',
                output,
            }, 'review-exhausted');
            return { status: 'review-exhausted', output };
        }
        const nextStageAttempt = job.data.stageAttempt + 1;
        const output = stageOutputSchemas.review.parse({
            status: 'review-failed',
            runId: job.data.runId,
            stageAttempt: nextStageAttempt,
            reworkAttempt: job.data.reworkAttempt,
            review: {
                status: 'failed',
                summary: 'Review failed.',
                content: parsed.content,
            },
        });
        const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
            runId: job.data.runId,
            fromStage: 'review',
            toStage: 'develop',
            stageAttempt: nextStageAttempt,
            reworkAttempt: job.data.reworkAttempt,
            dependsOn,
            status: 'rework-needed',
            output,
        });
        return {
            status: 'review-failed',
            output,
            developJobData: {
                ...createForwardStagePayload(job.data, 'develop', inputRecordRef),
                stageAttempt: nextStageAttempt,
                reworkAttempt: job.data.reworkAttempt,
            },
        };
    }
    const output = stageOutputSchemas.review.parse({
        status: 'review-malformed',
        runId: job.data.runId,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        review: {
            status: 'malformed',
            summary: 'Review response was malformed after repair.',
            rawResponse: parsed.rawResponse,
        },
    });
    await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
        runId: job.data.runId,
        fromStage: 'review',
        toStage: null,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn,
        status: 'failure',
        output,
    }, 'review-malformed');
    return { status: 'review-malformed', output };
}
export async function runReviewFlow(job) {
    const logger = createJobLogger(job);
    const result = await runReviewWork(job, logger);
    logger.info(`Reviewing run ${job.data.runId}`);
    if (result.status === 'success') {
        await scheduleNextJob(jobQueue, 'make-pr', result.makePrJobData);
        logger.info(`Make PR job enqueued for run: ${job.data.runId}`);
        return;
    }
    if (result.status === 'review-failed') {
        await scheduleNextJob(jobQueue, 'develop', result.developJobData);
        logger.info(`Develop rework job enqueued for run: ${job.data.runId}`);
        return;
    }
    logger.info(`Review stopped after ${result.status} for run: ${job.data.runId}`);
}
export const processReview = runReviewFlow;
export const reviewHandler = processReview;
