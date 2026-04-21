import type { Job } from 'bullmq';
import type { IssueProcessorJobData } from '../types/index.js';
import { createJobLogger } from './logger.js';
import { getRef, pushBranch } from '../github/branches.js';
import { createPullRequest } from '../github/pullRequests.js';

/**
 * Slugify a string for use in branch names
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
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
  const sha = await getRef('main');

  // Push the new branch
  await pushBranch(branchName, sha);

  // Create PR with issue title and body
  logger.info(`Creating PR from issue #${issue.number}`);
  const pr = await createPullRequest({
    title: issue.title,
    head: branchName,
    base: 'main',
    body: issue.body ?? '',
  });

  logger.info(`Created PR #${pr.number}: ${pr.htmlUrl}`);
}

/**
 * Handler for issue processor jobs - exported for use in worker
 */
export const issueProcessorHandler = processIssue;