import { spawn } from 'child_process';
import type { Job } from 'bullmq';
import type { CheckPrJobData, MakePrJobData } from '../types/index.js';
import { createPullRequest } from '../github/pullRequests.js';
import { moveIssueToInReview } from '../github/issue-labels.js';
import { cleanupWorkingDir, getRepoRemoteUrl } from '../utils/working-dir.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';

function execGitCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git command failed: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

async function pushWithRetry(
  remoteUrl: string,
  branchName: string,
  cwd: string,
  logger: ReturnType<typeof createJobLogger>,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await execGitCommand(['push', remoteUrl, branchName], cwd);
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt - 1) * 1000;
      logger.warn(`Push attempt ${attempt} failed for ${branchName}: ${err}, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export type MakePrWorkResult =
  | { status: 'no-changes' }
  | { status: 'pull-request-created'; pullRequest: CheckPrJobData['pullRequest'] };

function sanitizeForGit(text: string, maxLength = 200): string {
  return text.replace(/[\r\n]/g, ' ').slice(0, maxLength);
}

export async function runMakePrWork(
  job: Job<MakePrJobData>,
  logger = createJobLogger(job)
): Promise<MakePrWorkResult> {
  const { issue, branchName, repoPath } = job.data;

  logger.info(`Finalizing issue #${issue.number} on branch ${branchName}`);

  const status = await execGitCommand(['status', '--porcelain'], repoPath);

  if (!status) {
    logger.info('No changes detected, skipping commit, push, pull request, and label transition');
    return { status: 'no-changes' };
  }

  logger.info('Changes detected, committing...');
  await execGitCommand(['add', '-A'], repoPath);

  const sanitizedTitle = sanitizeForGit(issue.title);
  const commitResult = await execGitCommand(
    ['commit', '-m', `Processed issue #${issue.number} via codex: ${sanitizedTitle}`],
    repoPath
  );
  logger.info(`Changes committed: ${commitResult}`);

  logger.info('Pushing changes to remote branch...');
  await pushWithRetry(getRepoRemoteUrl(), branchName, repoPath, logger);
  logger.info(`Changes pushed to ${branchName}`);

  logger.info('Creating pull request...');
  const prResult = await createPullRequest({
    title: `Process issue #${issue.number}: ${sanitizedTitle}`,
    head: branchName,
    base: 'main',
    body: `Closes #${issue.number}`,
  });
  logger.info(`Pull request created: ${prResult.htmlUrl}`);

  try {
    const updatedLabels = await moveIssueToInReview(issue.number);
    logger.info(`Issue #${issue.number} labels updated: ${updatedLabels.join(', ')}`);
  } catch (err) {
    logger.warn(`Failed to update labels for issue #${issue.number}: ${err}`);
  }

  return {
    status: 'pull-request-created',
    pullRequest: prResult,
  };
}

export async function runMakePrFlow(job: Job<MakePrJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const { issue, branchName, repoPath } = job.data;

  try {
    const result = await runMakePrWork(job, logger);

    if (result.status === 'no-changes') {
      logger.info(`Cleaning up temp working directory: ${repoPath}`);
      await cleanupWorkingDir(repoPath);
      return;
    }

    const checkPrJobData: CheckPrJobData = {
      taskId: job.data.taskId,
      type: 'check-pr',
      issue,
      branchName,
      repoPath,
      pullRequest: result.pullRequest,
    };
    await scheduleNextJob(jobQueue, 'check-pr', checkPrJobData);
  } catch (err) {
    logger.error(`Make PR operation failed: ${err}`);
    throw err;
  }
}

export const processMakePr = runMakePrFlow;
export const makePrHandler = processMakePr;
