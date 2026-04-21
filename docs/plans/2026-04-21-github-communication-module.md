# GitHub Communication Module

## Overview
Design and implement a GitHub communication module (`src/github/`) that provides typed interfaces for interacting with GitHub via the Octokit REST SDK. The module supports fetching issues by filter, pushing branches, and creating pull requests.

## Context
- Files involved: `src/github/` (new directory), `src/config/index.ts`, `src/types/index.ts`
- Related patterns: Uses existing `createLogger` from `src/utils/logger.js`, follows ESNext module conventions with `.js` extensions
- Dependencies: `@octokit/rest` for GitHub API communication

## Development Approach
- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- CRITICAL: every task MUST include new/updated tests
- CRITICAL: all tests must pass before starting next task

## Implementation Steps

### Task 1: Install @octokit/rest dependency
- [x] Run `npm install @octokit/rest`
- [x] Add to package.json dependencies
- [x] Run full test suite - must pass before Task 2

### Task 2: Create GitHub client factory
**Files:**
- Create: `src/github/client.ts`

- [x] Create `createGitHubClient()` function that initializes Octokit with token from config
- [x] Export client instance for use by other modules
- [x] Write tests for client factory
- [x] Run project test suite - must pass before Task 3

### Task 3: Implement issues module
**Files:**
- Create: `src/github/issues.ts`
- Create: `src/github/issues.test.ts`

- [x] Add `IssueFilters` interface for filter options (labels, state, assignee, since, milestone)
- [x] Add `fetchIssues(filters)` function that calls `client.issues.listForRepo`
- [x] Map GitHub API response to existing `GitHubIssue` type from `src/types/index.ts`
- [x] Write unit tests with mocked Octokit
- [x] Run project test suite - must pass before Task 4

### Task 4: Implement branches module
**Files:**
- Create: `src/github/branches.ts`
- Create: `src/github/branches.test.ts`

- [x] Add `pushBranch(branchName, sha, force?)` function that calls `client.git.createRef`
- [x] Add `getRef(branchName)` function that calls `client.git.getRef`
- [x] Write unit tests with mocked Octokit
- [x] Run project test suite - must pass before Task 5

### Task 5: Implement pull requests module
**Files:**
- Create: `src/github/pullRequests.ts`
- Create: `src/github/pullRequests.test.ts`

- [x] Add `CreatePullRequestOptions` interface (title, head, base, body, draft)
- [x] Add `createPullRequest(options)` function that calls `client.pulls.create`
- [x] Write unit tests with mocked Octokit
- [x] Run project test suite - must pass before Task 6

### Task 6: Create module entry point and types
**Files:**
- Create: `src/github/index.ts`
- Create: `src/github/types.ts`

- [x] Re-export all functions from `src/github/index.ts`
- [x] Add GitHub-specific types (API response types not covered by existing `GitHubIssue`/`GitHubComment`)
- [x] Write integration-style tests for exports
- [x] Run project test suite - must pass before Task 7

### Task 7: Verify acceptance criteria
- [x] Run full test suite (npm test)
- [x] Run linter (npm run lint)
- [x] Verify test coverage meets 80%+ (run vitest coverage)

### Task 8: Update documentation
- [ ] Update CLAUDE.md if internal patterns changed (none expected)
- [ ] Move this plan to `docs/plans/completed/`