import type { Job } from 'bullmq';
import type { QualityGateJobData, QualityGateOutput, ReviewJobData } from '../types/index.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import {
  appendHandoffRecordAndUpdateSummary,
  readValidatedStageInputRecord,
  scheduleNextJob,
} from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';

const STUB_QUALITY = {
  status: 'passed',
  summary: 'Quality gate deferred for this iteration.',
} as const;

export async function runQualityGateWork(job: Job<QualityGateJobData>): Promise<ReviewJobData> {
  stagePayloadSchemas['quality-gate'].parse(job.data);
  const inputRecord = await readValidatedStageInputRecord(job.data);
  const developed = stageOutputSchemas.develop.parse(inputRecord.output);
  const output = stageOutputSchemas['quality-gate'].parse({
    ...developed,
    status: 'success',
    runId: job.data.runId,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    quality: STUB_QUALITY,
  }) as QualityGateOutput;
  const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(output.workspacePath, {
    runId: job.data.runId,
    fromStage: 'quality-gate',
    toStage: 'review',
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    dependsOn: job.data.inputRecordRef,
    status: 'success',
    output,
  });

  return createForwardStagePayload(job.data, 'review', inputRecordRef) as ReviewJobData;
}

export async function runQualityGateFlow(job: Job<QualityGateJobData>): Promise<void> {
  const logger = createJobLogger(job);

  const reviewJobData = await runQualityGateWork(job);
  const outputRecord = await readValidatedStageInputRecord(reviewJobData);
  const output = stageOutputSchemas['quality-gate'].parse(outputRecord.output);
  logger.info(`Running quality gate for issue #${output.issue.number} on branch ${output.branchName}`);
  await scheduleNextJob(jobQueue, 'review', reviewJobData);
  logger.info(`Review job enqueued for branch: ${output.branchName}`);
}

export const qualityGateHandler = runQualityGateFlow;
