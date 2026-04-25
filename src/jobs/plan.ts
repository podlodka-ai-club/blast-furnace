import type { Job } from 'bullmq';
import type { CodexProviderJobData, PlanJobData } from '../types/index.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';

export async function processPlan(job: Job<PlanJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const { issue, branchName } = job.data;

  logger.info(`Planning issue #${issue.number} on branch ${branchName}`);

  const codexJobData: CodexProviderJobData = {
    taskId: job.data.taskId,
    type: 'codex-provider',
    issue,
    branchName,
  };

  await jobQueue.add('codex-provider', codexJobData);
  logger.info(`Codex provider job enqueued for branch: ${branchName}`);
}

export const planHandler = processPlan;
