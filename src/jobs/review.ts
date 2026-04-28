import type { Job } from 'bullmq';
import type { MakePrJobData, ReviewJobData, ReviewOutput } from '../types/index.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import {
  appendHandoffRecordAndUpdateSummary,
  readValidatedStageInputRecord,
  resolveOrchestrationStorageRoot,
  scheduleNextJob,
} from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';

const STUB_REVIEW = {
  status: 'stubbed',
  summary: 'Review deferred for this iteration.',
} as const;

export async function runReviewWork(job: Job<ReviewJobData>): Promise<MakePrJobData> {
  stagePayloadSchemas.review.parse(job.data);
  const inputRecord = await readValidatedStageInputRecord(job.data);
  if (inputRecord.fromStage !== 'develop') {
    throw new Error(`review input must be produced by develop, got ${inputRecord.fromStage}`);
  }
  const developed = stageOutputSchemas.develop.parse(inputRecord.output);
  if (developed.quality.status !== 'passed') {
    throw new Error('review input quality.status must be passed');
  }
  const output = stageOutputSchemas.review.parse({
    ...developed,
    status: 'success',
    runId: job.data.runId,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    review: STUB_REVIEW,
  }) as ReviewOutput;
  const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
  const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
    runId: job.data.runId,
    fromStage: 'review',
    toStage: 'make-pr',
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    dependsOn: job.data.inputRecordRef,
    status: 'success',
    output,
  });

  return createForwardStagePayload(job.data, 'make-pr', inputRecordRef) as MakePrJobData;
}

export async function runReviewFlow(job: Job<ReviewJobData>): Promise<void> {
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
