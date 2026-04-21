import { githubClient } from './client.js';
import { config } from '../config/index.js';

/**
 * Options for creating a pull request
 */
export interface CreatePullRequestOptions {
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
}

/**
 * Response from creating a pull request
 */
export interface PullRequestResponse {
  number: number;
  htmlUrl: string;
}

/**
 * Create a pull request using the GitHub client
 */
export async function createPullRequest(options: CreatePullRequestOptions): Promise<PullRequestResponse> {
  const { title, head, base, body = '', draft = false } = options;

  const response = await githubClient.pulls.create({
    owner: config.github.owner,
    repo: config.github.repo,
    title,
    head,
    base,
    body,
    draft,
  });

  return {
    number: response.data.number,
    htmlUrl: response.data.html_url,
  };
}
