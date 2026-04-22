# Add Codex Provider for AI-Assisted Issue Processing

## Overview

Add a new BullMQ job type `codex-provider` that runs OpenAI's codex-cli on a GitHub issue in an isolated job worker. The codex provider receives an issue and branch, spawns `npx @openai/codex` with the issue as a prompt, waits for completion, and commits changes to the branch.

## Context

- Files involved:
  - `src/types/index.ts` (modify - add CodexProviderJobData type)
  - `src/jobs/codex-provider.ts` (new - codex provider job handler)
  - `src/jobs/index.ts` (modify - register codex-provider handler in multiHandler)
  - `src/jobs/issue-processor.ts` (modify - call codex provider after branch creation instead of creating PR)
  - `src/config/index.ts` (modify - add optional CODEX_CLI_PATH config)
- Related patterns: Existing BullMQ worker pattern, child_process.spawn for non-blocking process execution, git commands for branching and committing
- Dependencies: `npx @openai/codex` CLI installed in the project

## Development Approach

- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- CRITICAL: every task MUST include new/updated tests
- CRITICAL: all tests must pass before starting next task

## Implementation Steps

### Task 1: Add CodexProviderJobData type

**Files:**
- Modify: `src/types/index.ts`

- [x] Add `CodexProviderJobData` type extending `JobPayload` with `issue: GitHubIssue` and `branchName: string` fields
- [x] Write tests for the new type in `src/types/index.test.ts`
- [x] Run project test suite - must pass before Task 2

### Task 2: Create codex provider job handler

**Files:**
- Create: `src/jobs/codex-provider.ts`

- [x] Create `processCodex` async function that:
  - Receives issue and branchName from job data
  - Ensures git repo is on the correct branch (using existing git/branch.ts functions + `git checkout`)
  - Spawns `npx @openai/codex` as a child process with issue title+body as prompt (non-blocking via spawn)
  - Streams stdout/stderr to job logger
  - Waits for process to complete (or timeout after configurable period)
  - Runs `git add -A && git commit` to commit any changes made by codex
  - On failure, logs error and throws (triggers BullMQ retry)
- [x] Export `codexProviderHandler` for use in worker
- [x] Write tests with mocked child_process.spawn
- [x] Run project test suite - must pass before Task 3

### Task 3: Register codex provider in multiHandler

**Files:**
- Modify: `src/jobs/index.ts`

- [ ] Add `codex-provider` case in `multiHandler` routing to `codexProviderHandler`
- [ ] Write tests for routing in `src/jobs/index.test.ts`
- [ ] Run project test suite - must pass before Task 4

### Task 4: Modify issue processor to call codex provider

**Files:**
- Modify: `src/jobs/issue-processor.ts`

- [ ] After creating branch, add a `CodexProviderJobData` job to the queue instead of creating PR immediately
- [ ] Remove PR creation from issue processor (defer to after codex completes, or let codex/provider handle it)
- [ ] Update tests accordingly
- [ ] Run project test suite - must pass before Task 5

### Task 5: Add optional CODEX_CLI_PATH config

**Files:**
- Modify: `src/config/index.ts`

- [ ] Add `CODEX_CLI_PATH` env var (optional, defaults to `npx @openai/codex`)
- [ ] Add `CODEX_TIMEOUT_MS` env var (optional, default: 300000 = 5 minutes)
- [ ] Write tests for new config in `src/config/index.test.ts`
- [ ] Run project test suite - must pass before Task 6

### Task 6: Verify acceptance criteria

- [ ] Run full test suite (`npm test`)
- [ ] Run linter (`npm run lint`)
- [ ] Verify test coverage meets 80%+

### Task 7: Update documentation

- [ ] Update CLAUDE.md with new codex provider job type and config options
- [ ] Move this plan to `docs/plans/completed/`