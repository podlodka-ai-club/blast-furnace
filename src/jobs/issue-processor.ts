import type { Job } from 'bullmq';
import type { IssueProcessorJobData, PlanJobData } from '../types/index.js';
import { createJobLogger } from './logger.js';
import { getRef, pushBranch, deleteBranch } from '../github/branches.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';

/**
 * Slugify a string for use in branch names
 */
function slugify(text: string): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  // Truncate at hyphen boundary to avoid splitting words
  if (slug.length > 50) {
    const lastHyphen = slug.lastIndexOf('-', 50);
    if (lastHyphen > 0) {
      slug = slug.slice(0, lastHyphen);
    } else {
      slug = slug.slice(0, 50);
    }
  }

  // Remove any trailing hyphens from truncation
  slug = slug.replace(/-+$/, '');

  // Fallback to 'issue' if slug is empty (e.g., title was all special chars)
  return slug || 'issue';
}

export async function runIssueProcessorWork(
  job: Job<IssueProcessorJobData>,
  logger = createJobLogger(job)
): Promise<PlanJobData> {
  const { issue } = job.data;

  logger.info(`Processing issue #${issue.number}: ${issue.title}`);
  logger.info(`Issue body: ${issue.body ?? '(no body)'}`);

  // Create branch name: issue-{number}-{slug}
  const branchName = `issue-${issue.number}-${slugify(issue.title)}`;

  // Get the current main branch SHA
  let sha: string;
  try {
    await job.updateProgress({ step: 'fetching-main-ref' });
    sha = await getRef('main');
  } catch (err) {
    logger.error(`Failed to get ref for main: ${err}`);
    throw err;
  }

  // Check if branch already exists before creating it
  let branchExists = false;
  try {
    await getRef(branchName);
    branchExists = true;
  } catch {
    // Branch doesn't exist, which is what we want
  }

  if (branchExists) {
    logger.info(`Branch ${branchName} already exists, skipping creation`);
  } else {
    logger.info(`Creating branch: ${branchName}`);
    try {
      await job.updateProgress({ step: 'creating-branch', branch: branchName });
      await pushBranch(branchName, sha);
    } catch (err) {
      logger.error(`Failed to push branch ${branchName}: ${err}`);
      throw err;
    }
  }

  // Verify branch was created and enqueue codex job
  // If either fails, attempt to clean up the orphaned branch
  try {
    await job.updateProgress({ step: 'verifying-branch', branch: branchName });
    const verifySha = await getRef(branchName);
    logger.info(`Branch ${branchName} created successfully (SHA: ${verifySha})`);

    return {
      taskId: job.data.taskId,
      type: 'plan',
      issue,
      branchName,
    };
  } catch (err) {
    // Attempt to clean up the orphaned branch before re-throwing
    try {
      await deleteBranch(branchName);
      logger.info(`Cleaned up orphaned branch ${branchName}`);
    } catch (cleanupErr) {
      logger.error(`Failed to clean up orphaned branch ${branchName}: ${cleanupErr}`);
    }
    throw err;
  }
}

/**
 * Process an issue by logging it, preparing its branch, and enqueueing planning.
 */
export async function runIssueProcessorFlow(job: Job<IssueProcessorJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const planJobData = await runIssueProcessorWork(job, logger);

  try {
    await job.updateProgress({ step: 'enqueueing-plan', issue: planJobData.issue.number });
    logger.info(`Enqueueing plan job for issue #${planJobData.issue.number}`);
    await scheduleNextJob(jobQueue, 'plan', planJobData);
    logger.info(`Plan job enqueued for branch: ${planJobData.branchName}`);
  } catch (err) {
    try {
      await deleteBranch(planJobData.branchName);
      logger.info(`Cleaned up orphaned branch ${planJobData.branchName}`);
    } catch (cleanupErr) {
      logger.error(`Failed to clean up orphaned branch ${planJobData.branchName}: ${cleanupErr}`);
    }
    throw err;
  }
}

/**
 * Handler for issue processor jobs - exported for use in worker
 */
export const processIssue = runIssueProcessorFlow;
export const issueProcessorHandler = processIssue;
