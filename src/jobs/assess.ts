import type { Job } from 'bullmq';
import type { AssessJobData, PlanJobData } from '../types/index.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';

const STUB_ASSESSMENT = {
  status: 'stubbed',
  summary: 'Assessment deferred for this iteration.',
} as const;

export async function runAssessWork(job: Job<AssessJobData>): Promise<PlanJobData> {
  return createForwardStagePayload(job.data, 'plan', {
    assessment: STUB_ASSESSMENT,
  }) as PlanJobData;
}

export async function runAssessFlow(job: Job<AssessJobData>): Promise<void> {
  const logger = createJobLogger(job);
  logger.info(`Assessing issue #${job.data.issue.number} for run ${job.data.runId}`);

  const planJobData = await runAssessWork(job);
  await scheduleNextJob(jobQueue, 'plan', planJobData);
  logger.info(`Plan job enqueued for branch: ${planJobData.branchName}`);
}

export const assessHandler = runAssessFlow;
