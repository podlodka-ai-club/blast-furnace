import type { Job } from 'bullmq';
import type { QualityGateJobData, ReviewJobData } from '../types/index.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';

const STUB_QUALITY = {
  status: 'passed',
  summary: 'Quality gate deferred for this iteration.',
} as const;

export async function runQualityGateWork(job: Job<QualityGateJobData>): Promise<ReviewJobData> {
  return createForwardStagePayload(job.data, 'review', {
    quality: STUB_QUALITY,
  }) as ReviewJobData;
}

export async function runQualityGateFlow(job: Job<QualityGateJobData>): Promise<void> {
  const logger = createJobLogger(job);
  logger.info(`Running quality gate for issue #${job.data.issue.number} on branch ${job.data.branchName}`);

  const reviewJobData = await runQualityGateWork(job);
  await scheduleNextJob(jobQueue, 'review', reviewJobData);
  logger.info(`Review job enqueued for branch: ${reviewJobData.branchName}`);
}

export const qualityGateHandler = runQualityGateFlow;
