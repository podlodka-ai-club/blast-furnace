# Temp Working Directory for Git Operations

## Overview
Modify the codex-provider job to perform all git operations inside a unique temporary directory in `/tmp`, rather than using a persistent working directory or `process.cwd()`. Each job gets its own fresh clone.

## Context
- Files involved: `src/jobs/codex-provider.ts`, `src/jobs/codex-provider.test.ts`
- Related patterns: `execGitCommand` helper in codex-provider.ts, BullMQ job lifecycle
- Dependencies: `child_process` (already used), `fs` (Node.js built-in for temp dir cleanup), `crypto` (for unique dir names)

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Create temp working directory utility module

**Files:**
- Create: `src/utils/working-dir.ts`
- Create: `src/utils/working-dir.test.ts`

- [x] Create `src/utils/working-dir.ts` with:
  - `createTempWorkingDir(prefix: string): Promise<string>` - creates a unique dir in `/tmp` using `crypto.randomUUID()` for uniqueness
  - `cloneRepoInto(workingDir: string, remoteUrl: string): Promise<void>` - clones the GitHub repo into the working dir
  - `cleanupWorkingDir(workingDir: string): Promise<void>` - removes the temp directory recursively
  - `getRepoRemoteUrl(): string` - returns the HTTPS GitHub remote URL with token auth (moved from codex-provider.ts)
- [x] Write tests for working-dir.ts covering:
  - `createTempWorkingDir` creates a directory in /tmp with the expected prefix
  - `createTempWorkingDir` creates directories with unique names
  - `cleanupWorkingDir` removes the directory and its contents
  - `cloneRepoInto` calls git clone with correct args
- [x] Run project test suite - must pass before Task 2

### Task 2: Integrate temp working directory into codex-provider

**Files:**
- Modify: `src/jobs/codex-provider.ts`

- [x] Import the new `createTempWorkingDir`, `cloneRepoInto`, `cleanupWorkingDir`, `getRepoRemoteUrl` from working-dir.ts
- [x] Remove `getGithubRemoteUrl()` function (moved to working-dir.ts)
- [x] Remove `repoCwd = process.env['GIT_WORKING_DIR'] ?? process.cwd()` - replace with temp dir flow
- [x] Refactor `processCodex` to:
  - Create temp working dir at start (unique per job)
  - Clone the repo into it before any git operations
  - Run all git operations (fetch, checkout, commit) inside temp dir
  - Spawn codex process in the temp dir
  - Clean up temp dir in a `finally` block
- [x] Write/update tests for codex-provider.ts:
  - Verify clone is called with correct remote URL
  - Verify git operations use the temp directory (not cwd or GIT_WORKING_DIR)
  - Verify cleanup is called even when errors occur
- [x] Run project test suite - must pass before Task 3

### Task 3: Verify acceptance criteria

- [ ] Run full test suite (`npm test`)
- [ ] Run linter (`npm run lint`)
- [ ] Verify test coverage is maintained or improved

### Task 4: Update documentation

- [ ] Update CLAUDE.md if internal patterns changed (e.g., GIT_WORKING_DIR is no longer used)
- [ ] Move this plan to `docs/plans/completed/`