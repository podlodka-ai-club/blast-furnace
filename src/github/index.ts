// GitHub module entry point
// Re-exports all functions and types from submodules

// Client
export { githubClient, createGitHubClient } from './client.js';
export type { GitHubClient } from './client.js';

// Issues
export { fetchIssues } from './issues.js';
export type { IssueFilters } from './issues.js';
export { moveIssueToInReview, READY_LABEL, IN_REVIEW_LABEL } from './issue-labels.js';

// Branches
export { pushBranch, getRef } from './branches.js';

// Pull Requests
export { createPullRequest } from './pullRequests.js';
export type { CreatePullRequestOptions, PullRequestResponse } from './pullRequests.js';

// Types
export type { GitRef, BranchRefResponse, PullRequest } from './types.js';
