# Repository Polling UI

## Overview
Add a web UI page with a form to register GitHub repositories for polling, with Redis-backed deduplication.

## Context
- Files involved: `src/server/routes/repos.ts`, `src/server/index.ts`, `src/jobs/issue-watcher.ts`, `src/github/issues.ts`, `src/types/index.ts`
- Related patterns: Existing Fastify route pattern (`health.ts`, `github-webhooks.ts`), BullMQ Redis connection pattern
- Dependencies: None new - using existing ioredis and Redis connection

## Development Approach
- Regular approach: code first, then tests
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Add repository types and Redis key constant

**Files:**
- Modify: `src/types/index.ts`

- [x] Add `GitHubRepo` interface with `owner`, `repo`, `addedAt` fields
- [x] Add `RepoListResponse` type for API responses
- [x] Write tests for new types

**Files:**
- Modify: `src/jobs/issue-watcher.ts`

- [x] Add `REPO_LIST_KEY` constant for Redis set key `'github:repos'`

---

### Task 2: Create repository management module with Redis operations

**Files:**
- Create: `src/server/routes/repos.ts`

- [x] Create `addRepo(owner: string, repo: string): Promise<{ added: boolean; repo?: GitHubRepo }>` - adds repo to Redis set, returns false if duplicate
- [x] Create `listRepos(): Promise<GitHubRepo[]>` - returns all registered repos
- [x] Create `removeRepo(owner: string, repo: string): Promise<boolean>` - removes repo from Redis set
- [x] Create `repoExists(owner: string, repo: string): Promise<boolean>` - checks if repo exists
- [x] Create Fastify route plugin `reposRoute` with GET `/repos` and POST `/repos`
- [x] Write tests for repo management module

---

### Task 3: Create web UI HTML page

**Files:**
- Create: `src/server/routes/repos-ui.ts`

- [x] Create simple HTML page with form: owner input, repo input, submit button
- [x] Display list of registered repositories with remove button
- [x] Use vanilla HTML/CSS/JS (no framework)
- [x] Fastify route to serve HTML at GET `/repos`
- [x] Write tests for UI route

**Files:**
- Modify: `src/server/index.ts`

- [x] Register `reposRoute` plugin

---

### Task 4: Update issue watcher to poll multiple repositories

**Files:**
- Modify: `src/jobs/issue-watcher.ts`

- [ ] Modify `issueWatcherHandler` to fetch repo list from Redis
- [ ] For each registered repo, fetch issues using `fetchIssues` with that repo's owner/repo
- [ ] Write tests for multi-repo polling

**Files:**
- Modify: `src/github/issues.ts`

- [ ] Update `fetchIssues` to accept optional `owner` and `repo` overrides (for testing and future flexibility)

---

### Task 5: Update API types and create job data type for repo watching

**Files:**
- Modify: `src/types/index.ts`

- [ ] Add `RepoWatcherJobData` job data type for multi-repo polling
- [ ] Add `IssueWatcherJobData` update for multi-repo support

---

### Task 6: Verify acceptance criteria

- [ ] Run full test suite (`npm test`)
- [ ] Run linter (`npm run lint`)
- [ ] Verify test coverage meets 80%+

### Task 7: Update documentation

- [ ] Update CLAUDE.md if internal patterns changed
- [ ] Move this plan to `docs/plans/completed/`
