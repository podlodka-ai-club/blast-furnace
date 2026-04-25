import type { Job } from 'bullmq';
import type { CheckPrJobData } from '../types/index.js';
import { cleanupWorkingDir } from '../utils/working-dir.js';
import { createJobLogger } from './logger.js';

export async function runCheckPrWork(job: Job<CheckPrJobData>): Promise<string> {
  const logger = createJobLogger(job);
  const { issue, branchName, repoPath, pullRequest } = job.data;

  logger.info(`Checking PR #${pullRequest.number} for issue #${issue.number} on branch ${branchName}`);
  return repoPath;
}

export async function runCheckPrFlow(job: Job<CheckPrJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const repoPath = await runCheckPrWork(job);

  logger.info(`Cleaning up temp working directory: ${repoPath}`);
  await cleanupWorkingDir(repoPath);
}

export const processCheckPr = runCheckPrFlow;
export const checkPrHandler = processCheckPr;
