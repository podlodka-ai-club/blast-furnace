import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';
const STUB_REVIEW = {
    status: 'stubbed',
    summary: 'Review deferred for this iteration.',
};
export async function runReviewWork(job) {
    const { taskId, runId, reworkAttempt, issue, repository, branchName, workspacePath, development, quality } = job.data;
    return {
        taskId,
        type: 'make-pr',
        runId,
        stage: 'make-pr',
        stageAttempt: 1,
        reworkAttempt,
        issue,
        repository,
        branchName,
        workspacePath,
        development,
        quality,
        review: STUB_REVIEW,
    };
}
export async function runReviewFlow(job) {
    const logger = createJobLogger(job);
    logger.info(`Reviewing issue #${job.data.issue.number} on branch ${job.data.branchName}`);
    const makePrJobData = await runReviewWork(job);
    await scheduleNextJob(jobQueue, 'make-pr', makePrJobData);
    logger.info(`Make PR job enqueued for branch: ${makePrJobData.branchName}`);
}
export const processReview = runReviewFlow;
export const reviewHandler = processReview;
