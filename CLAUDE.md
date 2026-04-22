# Project Context for Claude Code

## Project Overview

Blast Furnace is an Agent Orchestrator server that runs continuously, receives GitHub Issues via polling or webhooks (configurable), and processes tasks through a pipeline using background jobs.

## Tech Stack

- **Language**: TypeScript (ESNext modules)
- **HTTP Framework**: Fastify v5
- **Background Jobs**: BullMQ v5 with Redis
- **Testing**: Vitest
- **Linting**: ESLint with typescript-eslint

## Directory Structure

```
src/
  index.ts           - Application entry point, builds and starts server
  config/
    index.ts         - Loads configuration from environment variables
    index.test.ts    - Config tests
  types/
    index.ts         - Shared TypeScript interfaces (TaskData, TaskResult, AgentConfig, GitHubIssue, etc.)
    index.test.ts    - Type tests
  utils/
    logger.ts        - Structured logging with pino
    logger.test.ts
  server/
    index.ts         - Fastify server factory with graceful shutdown
    index.test.ts    - Server tests
    routes/
      health.ts      - GET /health endpoint
      github-webhooks.ts - POST /webhooks/github for GitHub issue events
      repos.ts       - Repository management (Redis-backed CRUD for GitHub repos)
      repos-ui.ts    - Web UI for repository management (GET /repos/manage)
  jobs/
    index.ts         - Job infrastructure exports
    index.test.ts    - Job tests
    queue.ts         - BullMQ Queue and QueueEvents configuration
    worker.ts        - BullMQ Worker factory with logging middleware
    logger.ts        - Job-specific logging helper
    issue-watcher.ts - Polling-based GitHub issue watcher (repeatable job)
    issue-processor.ts - Shared issue processing job (logs issue, enqueues codex provider)
    codex-provider.ts - AI-assisted codex-cli job handler
  github/
    index.ts         - GitHub API client exports
    types.ts         - GitHub-specific TypeScript types
    client.ts        - Octokit client factory
    issues.ts        - GitHub issues API functions
    branches.ts      - GitHub branches/ref API functions
    pullRequests.ts  - GitHub pull requests API functions
```

## Key Interfaces

Defined in `src/types/index.ts`:
- `TaskData`, `TaskResult`, `TaskStatus`
- `PipelineStage`, `StageResult`
- `AgentConfig`, `AgentResult`
- `GitHubIssue`, `GitHubComment`, `GitHubRepo`
- `AppConfig`, `RedisConfig`, `GitHubConfig`
- `JobPayload`
- `IssueProcessorJobData`, `IssueWatcherJobData`, `RepoWatcherJobData`, `CodexProviderJobData` (job data types)
- `GitHubWebhookEvent`, `GitHubIssueEventPayload` (webhook types)
- `RepoListResponse` (API response type)

## Configuration

Most configuration is loaded from environment variables in `src/config/index.ts`:
- `NODE_ENV` (default: development)
- `PORT` (default: 3000)
- `REDIS_HOST` (default: localhost)
- `REDIS_PORT` (default: 6379)
- `REDIS_PASSWORD` (optional, no default)
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`
- `GITHUB_ISSUE_STRATEGY` (polling | webhook, default: polling) - how to receive GitHub issues
- `GITHUB_POLL_INTERVAL_MS` (default: 60000) - polling interval in milliseconds
- `GITHUB_WEBHOOK_SECRET` (optional) - HMAC secret for webhook signature validation
- `CODEX_CLI_PATH` (optional, default: npx @openai/codex) - path to codex CLI
- `CODEX_TIMEOUT_MS` (optional, default: 300000 = 5 minutes) - timeout for codex CLI execution

Additional configuration read directly from environment:
- `CORS_ORIGIN` (used in `src/server/index.ts`, default: true for development)

## Commands

- `npm run build` - Compile TypeScript to `dist/`
- `npm run dev` - Run with hot reload via tsx
- `npm test` - Run vitest
- `npm run test:watch` - Watch mode
- `npm run lint` - ESLint on `src/`

## Conventions

- Use ESNext modules (import/export with .js extensions)
- Strict TypeScript mode enabled
- Tests must pass before committing
- All new code requires tests
- Structured logging via pino
- Job retry: 3 attempts with exponential backoff
- Job concurrency: 5 (configurable)
