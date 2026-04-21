import { githubClient } from './client.js';
import { config } from '../config/index.js';

/**
 * Validates a branch name for safety
 * Branch names cannot contain path traversal sequences or start with dash
 */
function validateBranchName(branchName: string): void {
  if (!branchName || branchName.includes('..') || branchName.startsWith('-') || /\s/.test(branchName)) {
    throw new Error(`Invalid branch name: ${branchName}`);
  }
}

/**
 * Push a new branch (ref) to the repository
 */
export async function pushBranch(branchName: string, sha: string, force = false): Promise<void> {
  validateBranchName(branchName);
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
  validateBranchName(branchName);
  const response = await githubClient.git.getRef({
    owner: config.github.owner,
    repo: config.github.repo,
    ref: `heads/${branchName}`,
  });

  return response.data.object.sha;
}