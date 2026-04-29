import type { Job } from 'bullmq';
import type { MakePrJobData, ReviewJobData, ReviewOutput } from '../types/index.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { resolveReviewContext } from './context-resolvers.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import {
  appendHandoffRecordAndUpdateSummary,
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
  const context = await resolveReviewContext(job.data);
  const output = stageOutputSchemas.review.parse({
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
    dependsOn: [
      job.data.inputRecordRef,
      context.planRecord.recordId,
    ],
    status: 'success',
    output,
  });

  return createForwardStagePayload(job.data, 'make-pr', inputRecordRef) as MakePrJobData;
}

export async function runReviewFlow(job: Job<ReviewJobData>): Promise<void> {
  const logger = createJobLogger(job);

  const makePrJobData = await runReviewWork(job);
  logger.info(`Reviewing run ${job.data.runId}`);
  await scheduleNextJob(jobQueue, 'make-pr', makePrJobData);
  logger.info(`Make PR job enqueued for run: ${job.data.runId}`);
}

export const processReview = runReviewFlow;
export const reviewHandler = processReview;
