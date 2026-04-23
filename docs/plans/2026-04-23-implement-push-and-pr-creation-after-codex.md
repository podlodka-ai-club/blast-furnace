# Implement Push and PR Creation After Codex Execution

## Overview
Complete the issue processing pipeline by adding push and PR creation steps to the codex-provider job. After codex-cli commits changes locally, the job must push those commits to the remote branch and create a pull request, then clean up the working directory.

## Context
- Files involved:
  - `src/jobs/codex-provider.ts` (modify - add push and PR creation)
  - `src/github/pullRequests.ts` (use existing createPullRequest function)
  - `src/utils/working-dir.ts` (use existing getRepoRemoteUrl for authenticated push)
- Related patterns: git push via child_process.spawn, GitHub API PR creation
- Dependencies: GitHub API token for authenticated pushes

## Development Approach
- Regular development: implement code first, then write tests
- Each task must be completed fully before moving to the next
- CRITICAL: every task MUST include new/updated tests
- CRITICAL: all tests must pass before starting next task

## Implementation Steps

### Task 1: Add git push to codex-provider after commit

**Files:**
- Modify: `src/jobs/codex-provider.ts`

- [x] After successful commit, add `git push` using the authenticated remote URL from `getRepoRemoteUrl()`
- [x] Use the existing `execGitCommand` helper with retry logic
- [x] Update job logger to indicate push is happening
- [x] Write/update tests for the push behavior
- [x] Run project test suite - must pass before Task 2

### Task 2: Add PR creation after push

**Files:**
- Modify: `src/jobs/codex-provider.ts`

- [x] Import and call `createPullRequest` from `src/github/pullRequests.js`
- [x] PR title: "Process issue #${issue.number}: ${issue.title}"
- [x] PR head: the branch name
- [x] PR base: "main"
- [x] PR body: Include issue number and link, e.g. "Closes #${issue.number}"
- [x] Log PR creation success with the PR URL
- [x] Write/update tests for PR creation (mock the pullRequests module)
- [x] Run project test suite - must pass before Task 3

### Task 3: Reorder cleanup to happen after push and PR

**Files:**
- Modify: `src/jobs/codex-provider.ts`

- [ ] Move `cleanupWorkingDir` call from the commit section to after PR creation
- [ ] Ensure cleanup happens in a `finally` block or after both push and PR succeed
- [ ] Update tests to reflect the new flow order
- [ ] Run project test suite - must pass before Task 4

### Task 4: Verify acceptance criteria

- [ ] Run full test suite (`npm test`)
- [ ] Run linter (`npm run lint`)
- [ ] Verify test coverage remains above 80%

### Task 5: Update documentation

- [ ] Move this plan to `docs/plans/completed/`
