# GitHub Issue Receiver and PR Creation Job

## Overview
Add two strategies to receive GitHub issues reactively (polling and webhooks), configurable via environment variable, and create a background job that prints issue text to console and creates a PR using the issue description.

## Context
- Files involved:
  - `src/config/index.ts` (modify - add issue strategy and webhook/polling config)
  - `src/types/index.ts` (modify - add webhook payload types and job types)
  - `src/server/routes/github-webhooks.ts` (new - webhook endpoint)
  - `src/server/index.ts` (modify - register webhook route)
  - `src/jobs/issue-watcher.ts` (new - polling-based issue watcher)
  - `src/jobs/issue-processor.ts` (new - shared issue processing job)
  - `src/jobs/index.ts` (modify - export new jobs)
  - `src/github/issues.ts` (existing - fetchIssues)
  - `src/github/pullRequests.ts` (existing - createPullRequest)
  - `src/github/branches.ts` (existing - pushBranch, getRef)
  - `src/index.ts` (modify - conditionally start strategy)
- Related patterns: Existing BullMQ worker pattern in `src/jobs/worker.ts`, existing GitHub API patterns, BullMQ repeatable jobs for polling
- Dependencies: `crypto` (built-in, for HMAC webhook validation)

## Development Approach
- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Add issue strategy and polling/webhook configuration
**Files:**
- Modify: `src/config/index.ts`
- [x] Add `GITHUB_ISSUE_STRATEGY` environment variable with values "polling" | "webhook" (default: "polling")
- [x] Add `GITHUB_POLL_INTERVAL_MS` environment variable (default: 60000 - 1 minute)
- [x] Add `GITHUB_WEBHOOK_SECRET` environment variable (optional, for webhook signature validation)
- [x] Add `issueStrategy`, `pollIntervalMs`, and `webhookSecret` to `GitHubConfig` interface
- [x] Write tests for issue strategy and config

### Task 2: Add webhook payload types and job types
**Files:**
- Modify: `src/types/index.ts`
- [x] Add `GitHubWebhookEvent` type for webhook payload envelope
- [x] Add `GitHubIssueEventPayload` type for issue event action and issue data
- [x] Add `IssueProcessorJobData` type extending `JobPayload` with `issue` field
- [x] Add `IssueWatcherJobData` type for polling job
- [x] Write tests for new types

### Task 3: Create issue processor job (shared by both strategies)
**Files:**
- Create: `src/jobs/issue-processor.ts`
- [x] Create `processIssue` function that:
  - Extracts issue data from job payload
  - Logs issue title and body to console using the job logger
  - Creates a new branch with name `issue-{number}-{slug}` using `getRef` and `pushBranch`
  - Creates PR with issue title, body as description, head=new branch, base=main
- [x] Export `issueProcessorHandler` for use in worker
- [x] Write tests with mocked GitHub API calls

### Task 4: Create polling-based issue watcher job
**Files:**
- Create: `src/jobs/issue-watcher.ts`
- [x] Create `startIssueWatcher` function that adds a repeatable job to the queue using `add` with `repeat` option (every `pollIntervalMs`)
- [x] Create `issueWatcherHandler` function that:
  - Fetches open issues using `fetchIssues` with `since` filter based on last poll time
  - For each new issue, adds an `IssueProcessorJobData` job to the queue
  - Updates last poll timestamp
- [x] Export `startIssueWatcher` and `issueWatcherHandler` for use in index.ts
- [x] Write tests with mocked fetchIssues

### Task 5: Create GitHub webhooks route
**Files:**
- Create: `src/server/routes/github-webhooks.ts`
- [x] Create `githubWebhooksRoute` plugin with Fastify
- [x] Add POST `/webhooks/github` endpoint
- [x] If `GITHUB_WEBHOOK_SECRET` is set, validate webhook signature using HMAC SHA256; skip validation if not set (development mode)
- [x] Parse and validate incoming webhook payload
- [x] On `issues.opened` event, add `IssueProcessorJobData` job to queue immediately
- [x] Return 200 quickly to acknowledge receipt (async processing)
- [x] Write tests for webhook validation and routing

### Task 6: Register webhook route in server
**Files:**
- Modify: `src/server/index.ts`
- [x] Import and register `githubWebhooksRoute` (always registered when webhook strategy is selected)
- [x] Write test verifying webhook route registration

### Task 7: Conditionally start polling or webhook based on config
**Files:**
- Modify: `src/index.ts`
- [x] Check `config.github.issueStrategy` on startup
- [x] If "polling": import and call `startIssueWatcher` to begin polling
- [x] If "webhook": webhook route is already registered via server; no additional startup action needed
- [x] Replace placeholder processor with multi-handler that routes jobs by type
- [x] Route `IssueProcessorJobData` jobs to `issueProcessorHandler`
- [x] Write test verifying strategy selection logic

### Task 8: Verify acceptance criteria
- [ ] Run full test suite (`npm test`)
- [ ] Run linter (`npm run lint`)
- [ ] Verify test coverage meets 80%+

### Task 9: Update documentation
- [ ] Update CLAUDE.md with new webhook endpoint, polling configuration, and issue strategy option
- [ ] Move this plan to `docs/plans/completed/`