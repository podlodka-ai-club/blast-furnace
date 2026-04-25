import { githubClient } from './client.js';
import { config } from '../config/index.js';
function validateBranchName(branchName) {
    if (!branchName || branchName.includes('..') || branchName.startsWith('-') || /\s/.test(branchName)) {
        throw new Error(`Invalid branch name: ${branchName}`);
    }
}
export async function pushBranch(branchName, sha, force = false) {
    validateBranchName(branchName);
    await githubClient.git.createRef({
        owner: config.github.owner,
        repo: config.github.repo,
        ref: `refs/heads/${branchName}`,
        sha,
        force,
    });
}
export async function getRef(branchName) {
    validateBranchName(branchName);
    const response = await githubClient.git.getRef({
        owner: config.github.owner,
        repo: config.github.repo,
        ref: `heads/${branchName}`,
    });
    return response.data.object.sha;
}
export async function deleteBranch(branchName) {
    validateBranchName(branchName);
    await githubClient.git.deleteRef({
        owner: config.github.owner,
        repo: config.github.repo,
        ref: `heads/${branchName}`,
    });
}
