import { Octokit } from '@octokit/rest';
import { config } from '../config/index.js';

export type GitHubClient = InstanceType<typeof Octokit>;

export function createGitHubClient(): GitHubClient {
  return new Octokit({
    auth: config.github.token,
  });
}

export const githubClient = createGitHubClient();