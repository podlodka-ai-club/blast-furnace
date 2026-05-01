
# Project Context for Claude Code

## Project Overview

Blast Furnace is an Agent Orchestrator server that runs continuously, receives GitHub Issues through polling intake, and processes tasks through a pipeline using background jobs.

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
    working-dir.ts   - Temp working directory utilities for git operations
    working-dir.test.ts
  server/
    index.ts         - Fastify server factory with graceful shutdown
    index.test.ts    - Server tests
    routes/
      health.ts      - GET /health endpoint
      repos.ts       - Repository management (Redis-backed CRUD for GitHub repos)
      repos-ui.ts    - Web UI for repository management (GET /repos/manage)
  jobs/
    index.ts         - Job infrastructure exports
    index.test.ts    - Job tests
    queue.ts         - BullMQ Queue and QueueEvents configuration
    worker.ts        - BullMQ Worker factory with logging middleware
    logger.ts        - Job-specific logging helper
    intake.ts - Polling-based GitHub issue intake (repeatable job)
    prepare-run.ts - Run bootstrap, branch setup, and workspace preparation
    assess.ts - Stub-safe assessment stage
    plan.ts - Stub-safe planning stage
    develop.ts - Codex CLI executor stage
    quality-gate.ts - Stub-safe quality gate stage
    review.ts - Stub-safe review stage
    make-pr.ts - Commit, push, and pull request creation
    sync-tracker-state.ts - Post-PR tracker synchronization and cleanup
  github/
    index.ts         - GitHub API client exports
    types.ts         - GitHub-specific TypeScript types
    client.ts        - Octokit client factory
    issues.ts        - GitHub issues API functions
    branches.ts      - GitHub branches/ref API functions
    pullRequests.ts  - GitHub pull requests API functions
    issue-labels.ts  - Issue label transition helpers
```

## Key Interfaces

Defined in `src/types/index.ts`:
- `TaskData`, `TaskResult`, `TaskStatus`
- `PipelineStage`, `StageResult`
- `AgentConfig`, `AgentResult`
- `GitHubIssue`, `GitHubComment`, `GitHubRepo`
- `AppConfig`, `RedisConfig`, `GitHubConfig`
- `JobPayload`
- `WorkflowStage`, `StageJobPayload`, `IntakeJobData`, `PrepareRunJobData`, `AssessJobData`, `PlanJobData`, `DevelopJobData`, `QualityGateJobData`, `ReviewJobData`, `MakePrJobData`, `SyncTrackerStateJobData` (job data types)
- `RepoListResponse` (API response type)

## Configuration

Most configuration is loaded from environment variables in `src/config/index.ts`:
- `NODE_ENV` (default: development)
- `PORT` (default: 3000)
- `REDIS_HOST` (default: localhost)
- `REDIS_PORT` (default: 6379)
- `REDIS_PASSWORD` (optional, no default)
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`
- `GITHUB_POLL_INTERVAL_MS` (default: 60000) - polling interval in milliseconds
- `CODEX_CLI_PATH` (optional, default: npx @openai/codex) - command used to launch codex CLI
- `CODEX_MODEL` (optional, default: gpt-5.4) - model passed to codex CLI
- `CODEX_TIMEOUT_MS` (optional, default: 600000 = 10 minutes) - timeout for codex CLI execution

Additional configuration read directly from environment:
- `CORS_ORIGIN` (used in `src/server/index.ts`, default: true for development)

## Commands

- `npm run build` - Compile TypeScript to `dist/`
- `npm run dev` - Run with hot reload via tsx
- `npm test` - Run vitest
- `npm run test:watch` - Watch mode
- `npm run lint` - ESLint on `src/`

## Docker Redis Setup

The project uses Docker Compose to run Redis locally. See `docs/docker.md` for details, but the quick reference is:

- `./scripts/start.sh` - Start Redis and the dev server
- `./scripts/stop.sh` - Stop Redis and the dev server
- `docker-compose up -d` - Start Redis only
- `docker-compose down` - Stop Redis only

Runtime note for Codex: `./scripts/start.sh` needs Docker socket access and local server networking. When asked to run the server through this script, request escalated execution immediately instead of first trying the sandboxed command. Health checks against `http://127.0.0.1:3000/health` may also need escalated execution if sandbox networking cannot see the local port.

## Conventions

- Use ESNext modules (import/export with .js extensions)
- Strict TypeScript mode enabled
- Follow test-driven development for every feature or behavior change:
  1. Write a focused failing test that captures the requested behavior before changing implementation code.
  2. Run the relevant test command and confirm the new test fails for the expected reason.
  3. Implement the smallest change that makes the test pass.
  4. Run the relevant tests again and confirm they pass before broadening the change.
- Bug fixes must start with a regression test that fails before the fix.
- All new code requires tests.
- Tests must pass before committing.
- Structured logging via pino
- Job retry: 3 attempts with exponential backoff
- Job concurrency: 5 (configurable)
