import type { Job } from 'bullmq';
import type { CodexProviderJobData, PlanJobData } from '../types/index.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';

export async function runPlanWork(job: Job<PlanJobData>): Promise<CodexProviderJobData> {
  const { issue, branchName } = job.data;

  return {
    taskId: job.data.taskId,
    type: 'codex-provider',
    issue,
    branchName,
  };
}

export async function runPlanFlow(job: Job<PlanJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const { issue, branchName } = job.data;

  logger.info(`Planning issue #${issue.number} on branch ${branchName}`);

  const codexJobData = await runPlanWork(job);

  await scheduleNextJob(jobQueue, 'codex-provider', codexJobData);
  logger.info(`Codex provider job enqueued for branch: ${branchName}`);
}

export const processPlan = runPlanFlow;
export const planHandler = processPlan;
