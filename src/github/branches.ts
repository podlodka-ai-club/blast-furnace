import { githubClient } from './client.js';
import { config } from '../config/index.js';

/**
 * Push a new branch (ref) to the repository
 */
export async function pushBranch(branchName: string, sha: string, force = false): Promise<void> {
  await githubClient.git.createRef({
    owner: config.github.owner,
    repo: config.github.repo,
    ref: `refs/heads/${branchName}`,
    sha,
    force,
  });
}

/**
 * Get a reference (branch) from the repository
 */
export async function getRef(branchName: string): Promise<string> {
  const response = await githubClient.git.getRef({
    owner: config.github.owner,
    repo: config.github.repo,
    ref: `heads/${branchName}`,
  });

  return response.data.object.sha;
}