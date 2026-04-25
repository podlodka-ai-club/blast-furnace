import type { Job } from 'bullmq';
import type { CodexProviderJobData, IssueProcessorJobData } from '../types/index.js';
import { createJobLogger } from './logger.js';
import { getRef, pushBranch, deleteBranch } from '../github/branches.js';
import { jobQueue } from './queue.js';

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

/**
 * Process an issue by logging it and creating a PR from it
 */
export async function processIssue(job: Job<IssueProcessorJobData>): Promise<void> {
  const logger = createJobLogger(job);
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

    await job.updateProgress({ step: 'enqueueing-codex', issue: issue.number });
    logger.info(`Enqueueing codex provider job for issue #${issue.number}`);
    const codexJobData: CodexProviderJobData = {
      taskId: job.data.taskId,
      type: 'codex-provider',
      issue,
      branchName,
    };

    await jobQueue.add('codex-provider', codexJobData);
    logger.info(`Codex provider job enqueued for branch: ${branchName}`);
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
 * Handler for issue processor jobs - exported for use in worker
 */
export const issueProcessorHandler = processIssue;