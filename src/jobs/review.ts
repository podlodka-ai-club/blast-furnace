import type { Job } from 'bullmq';
import type { MakePrJobData, ReviewJobData } from '../types/index.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';

export async function runReviewWork(job: Job<ReviewJobData>): Promise<MakePrJobData> {
  const { issue, branchName, repoPath } = job.data;

  return {
    taskId: job.data.taskId,
    type: 'make-pr',
    issue,
    branchName,
    repoPath,
  };
}

export async function runReviewFlow(job: Job<ReviewJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const { issue, branchName } = job.data;

  logger.info(`Reviewing issue #${issue.number} on branch ${branchName}`);

  const makePrJobData = await runReviewWork(job);

  await scheduleNextJob(jobQueue, 'make-pr', makePrJobData);
  logger.info(`Make PR job enqueued for branch: ${branchName}`);
}

export const processReview = runReviewFlow;
export const reviewHandler = processReview;
