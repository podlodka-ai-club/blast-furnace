import { githubClient } from './client.js';
import { config } from '../config/index.js';
import type { GitHubIssue } from '../types/index.js';

/**
 * Filter options for fetching GitHub issues
 */
export interface IssueFilters {
  labels?: string;
  state?: 'open' | 'closed' | 'all';
  assignee?: string;
  since?: string;
  milestone?: number;
}

/**
 * Maps raw GitHub API issue response to our GitHubIssue type
 */
function mapGitHubIssueResponse(
  issue: Awaited<ReturnType<typeof githubClient.issues.listForRepo>>['data'][number]
): GitHubIssue {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state as 'open' | 'closed',
    labels: issue.labels.map((label) => (typeof label === 'string' ? label : label.name)),
    assignee: issue.assignee?.login ?? null,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
}

/**
 * Fetch issues from the repository using the GitHub client
 */
export async function fetchIssues(filters: IssueFilters = {}): Promise<GitHubIssue[]> {
  const { labels, state, assignee, since, milestone } = filters;

  const response = await githubClient.issues.listForRepo({
    owner: config.github.owner,
    repo: config.github.repo,
    labels,
    state: state ?? 'open',
    assignee,
    since: since ? new Date(since) : undefined,
    milestone: milestone ?? undefined,
  });

  return response.data.map(mapGitHubIssueResponse);
}
