import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { appendHandoffRecordAndUpdateSummary, readValidatedStageInputRecord, scheduleNextJob, } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
const STUB_REVIEW = {
    status: 'stubbed',
    summary: 'Review deferred for this iteration.',
};
export async function runReviewWork(job) {
    stagePayloadSchemas.review.parse(job.data);
    const inputRecord = await readValidatedStageInputRecord(job.data);
    const quality = stageOutputSchemas['quality-gate'].parse(inputRecord.output);
    const output = stageOutputSchemas.review.parse({
        ...quality,
        status: 'success',
        runId: job.data.runId,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        review: STUB_REVIEW,
    });
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(output.workspacePath, {
        runId: job.data.runId,
        fromStage: 'review',
        toStage: 'make-pr',
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn: job.data.inputRecordRef,
        status: 'success',
        output,
    });
    return createForwardStagePayload(job.data, 'make-pr', inputRecordRef);
}
export async function runReviewFlow(job) {
    const logger = createJobLogger(job);
    const makePrJobData = await runReviewWork(job);
    const outputRecord = await readValidatedStageInputRecord(makePrJobData);
    const output = stageOutputSchemas.review.parse(outputRecord.output);
    logger.info(`Reviewing issue #${output.issue.number} on branch ${output.branchName}`);
    await scheduleNextJob(jobQueue, 'make-pr', makePrJobData);
    logger.info(`Make PR job enqueued for branch: ${output.branchName}`);
}
export const processReview = runReviewFlow;
export const reviewHandler = processReview;
