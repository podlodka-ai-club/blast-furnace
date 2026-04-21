import type { Job } from 'bullmq';
import type { IssueProcessorJobData } from '../types/index.js';
import { createJobLogger } from './logger.js';
import { getRef, pushBranch } from '../github/branches.js';
import { createPullRequest } from '../github/pullRequests.js';

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
  logger.info(`Creating branch: ${branchName}`);
  let sha: string;
  try {
    sha = await getRef('main');
  } catch (err) {
    logger.error(`Failed to get ref for main: ${err}`);
    throw err;
  }

  // Push the new branch
  try {
    await pushBranch(branchName, sha);
  } catch (err) {
    logger.error(`Failed to push branch ${branchName}: ${err}`);
    throw err;
  }

  // Create PR with issue title and body
  logger.info(`Creating PR from issue #${issue.number}`);
  let pr: { number: number; htmlUrl: string };
  try {
    pr = await createPullRequest({
      title: issue.title,
      head: branchName,
      base: 'main',
      body: issue.body ?? '',
    });
  } catch (err) {
    logger.error(`Failed to create PR for issue #${issue.number}: ${err}`);
    throw err;
  }

  logger.info(`Created PR #${pr.number}: ${pr.htmlUrl}`);
}

/**
 * Handler for issue processor jobs - exported for use in worker
 */
export const issueProcessorHandler = processIssue;