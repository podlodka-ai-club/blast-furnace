export { githubClient, createGitHubClient } from './client.js';
export type { GitHubClient } from './client.js';
export { fetchIssues } from './issues.js';
export type { IssueFilters } from './issues.js';
export { pushBranch, getRef } from './branches.js';
export { createPullRequest } from './pullRequests.js';
export type { CreatePullRequestOptions, PullRequestResponse } from './pullRequests.js';
export type { GitRef, BranchRefResponse, PullRequest } from './types.js';
