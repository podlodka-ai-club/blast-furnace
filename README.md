# Blast Furnace

Agent Orchestrator server that receives GitHub Issues through polling and processes tasks through background jobs using BullMQ.

## Overview

Blast Furnace is a continuous-running server that watches one configured GitHub repository for new issues using polling intake. When an issue is discovered, it is queued for processing, which logs the issue details, creates a new branch based on the issue, and opens a pull request.

## Prerequisites

- Node.js >= 20.0.0
- Redis server (for BullMQ job queue)

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.local.example .env.local
   source ./scripts/load-env.sh
   ```

3. Start Redis and the development server:
   ```bash
   ./scripts/start.sh
   ```

   The start script loads `.env.local` when present, starts Redis with Docker Compose, waits for Redis to become healthy, then runs `npm run dev`.

   To start Redis manually instead:
   ```bash
   docker-compose up -d
   npm run dev
   ```

## Configuration

All configuration is loaded from environment variables.

For local development, you can keep them in `.env.local` using shell `export` syntax.
The project includes:

- `.env.local.example` - template with the expected variables
- `source ./scripts/load-env.sh` - loads `.env.local` into your current shell
- `./scripts/start.sh` - automatically loads `.env.local` if it exists

### Required Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token |
| `GITHUB_OWNER` | Repository owner (user or organization) |
| `GITHUB_REPO` | Repository name |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Environment: development or production |
| `PORT` | 3000 | HTTP server port |
| `REDIS_HOST` | localhost | Redis host |
| `REDIS_PORT` | 6379 | Redis port |
| `REDIS_PASSWORD` | (none) | Redis password (optional) |
| `CORS_ORIGIN` | true | CORS allowed origins, comma-separated list or `*` for all |
| `GITHUB_POLL_INTERVAL_MS` | 60000 | Polling interval in milliseconds (minimum 1000) |
| `CODEX_CLI_PATH` | `npx @openai/codex` | Command used to launch Codex CLI |
| `CODEX_MODEL` | `gpt-5.4` | Model passed to Codex CLI with `--model` |
| `CODEX_TIMEOUT_MS` | 300000 | Codex CLI timeout in milliseconds |

## Architecture

### Operating Model

The orchestrator is built as a queue-driven pipeline. Each major stage runs as a BullMQ job, persists its input as JSON-compatible `job.data`, and schedules the next stage by adding another job to the queue. Stages do not call each other directly.

Redis is the shared persistence layer behind this model:
- BullMQ stores queued jobs, retry state, and stage payloads in Redis
- The application stores supporting state in Redis, such as the last poll timestamp

Current high-level flow:

```text
GitHub polling intake
  -> intake job
      -> BullMQ queue
          -> prepare-run job
              -> BullMQ queue
                  -> assess -> plan -> develop -> quality-gate -> review
                      -> make-pr
                          -> sync-tracker-state when a PR is created
```

Every workflow stage payload includes `runId`, `stage`, `stageAttempt`, and `reworkAttempt`. For example, `prepare-run` receives a `GitHubIssue`, creates or verifies `issue-{number}-{slugified-title}`, prepares a local workspace, then enqueues `assess` with the same run, issue, repository, branch, workspace, and attempt data. If a worker is available, BullMQ may run the next job almost immediately; otherwise it remains queued until worker capacity is available.

### HTTP Framework

Fastify v5 is used as the HTTP framework due to its performance and TypeScript compatibility.

### Intake

Issues are received through polling. A repeatable `intake` job periodically fetches open GitHub issues labeled `ready` from the repository configured by `GITHUB_OWNER` and `GITHUB_REPO`.

### Background Job Processing

BullMQ v5 with Redis provides the background job infrastructure:

- **Retry Policy**: 3 attempts with exponential backoff (1s initial delay)
- **Concurrency**: 5 jobs processed simultaneously
- **Cleanup**: Completed jobs removed after 100 jobs or 24 hours; failed jobs removed after 500 jobs or 7 days

The current job flow is:

1. Intake
2. Prepare Run: creates the run identity, creates or reuses `issue-{number}-{slugified-title}`, prepares the local workspace, then enqueues Assess
3. Assess: currently produces stub assessment data and enqueues Plan
4. Plan: currently produces stub plan data and enqueues Develop
5. Develop: runs Codex CLI in the prepared workspace and enqueues Quality Gate
6. Quality Gate: currently produces a stub passing quality result and enqueues Review
7. Review: currently produces stub review data and enqueues Make PR
8. Make PR: commits, pushes, and opens a PR when changes exist; no-change runs clean up and finish here
9. Sync Tracker State: after a PR is created, attempts to move labels from `ready` to `in review` and performs terminal workspace cleanup

## Features

### Intake

- A repeatable job runs on a configurable interval (default: 60 seconds)
- The last poll timestamp is stored in Redis, not in job data (which is static for repeatable jobs)
- On first run, all open issues are fetched; subsequent runs fetch only issues updated since last poll

### Issue Processing

When an issue is queued:

1. The issue is logged
2. A branch is created or reused: `issue-{number}-{slugified-title}`
3. The prepared workspace flows through Assess and Plan into Develop
4. Codex CLI is run with the issue title, body, and available plan context as the prompt
5. If Codex changes files, Make PR commits, pushes, and creates a PR with body `Closes #{number}`
6. If Codex makes no changes, Make PR skips commit, push, PR creation, and tracker synchronization
7. When a PR is created, Sync Tracker State attempts to replace `ready` with `in review`

### API Endpoints

**GET /health**

- Returns server health status with timestamp and uptime in seconds
- Response: `{ "status": "ok", "timestamp": "2026-04-22T00:00:00.000Z", "uptime": 1234 }`

## Implementation Details

### ESNext Modules with .js Extensions

Import/export statements use `.js` extensions even for local files:
```typescript
import { buildServer } from './server/index.js';
```
This is required for ESNext module resolution with TypeScript.

### Strict TypeScript Mode

The project uses strict TypeScript mode with:
- `strict: true` in tsconfig
- `moduleResolution: bundler` for ESNext compatibility

### Multi-Handler Job Routing

A single worker handles multiple job types via a switch statement in `src/index.ts`:

```typescript
export async function multiHandler(job: Job<JobPayload>): Promise<void> {
  switch (job.data.type) {
    case 'intake':
      return intakeHandler(job as Job<IntakeJobData>);
    case 'prepare-run':
      return prepareRunHandler(job as Job<PrepareRunJobData>);
    case 'develop':
      return developHandler(job as Job<DevelopJobData>);
    case 'sync-tracker-state':
      return syncTrackerStateHandler(job as Job<SyncTrackerStateJobData>);
    default:
      throw new Error(`Unknown job type: ${job.data.type}`);
  }
}
```

### Repeatable Jobs and Redis Timestamp Storage

BullMQ repeatable jobs have static job data. To track dynamic state (last poll time), Intake stores the timestamp in Redis:
```typescript
const LAST_POLL_KEY = 'github:intake:last-poll';
// Store after fetching
await redisClient.set(LAST_POLL_KEY, new Date().toISOString());
// Read before fetching
const lastPollTimestamp = await redisClient.get(LAST_POLL_KEY);
```

### Branch Name Validation and Slugify

Branch names are validated to prevent path traversal and other issues:
```typescript
function validateBranchName(branchName: string): void {
  if (!branchName || branchName.includes('..') || branchName.startsWith('-') || /\s/.test(branchName)) {
    throw new Error(`Invalid branch name: ${branchName}`);
  }
}
```

The slugify algorithm:
- Converts to lowercase, removes non-alphanumeric characters (except spaces and hyphens)
- Replaces spaces with hyphens
- Truncates at 50 characters on a hyphen boundary
- Falls back to 'issue' if empty

### Worker Concurrency and Retries

The worker processes 5 jobs concurrently with 3 retry attempts on failure:
```typescript
new Worker<JobPayload>('agent-orchestrator', processor, {
  concurrency: 5,
  // ... connection config
});
// Queue defaultJobOptions:
{
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
}
```

### Graceful Shutdown Sequence

Shutdown follows this order with a 10-second timeout:
1. Close the HTTP server (stop accepting new connections)
2. Close the worker (finish processing current jobs)
3. Close the queue events and queue

```typescript
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  const timeout = setTimeout(() => {
    console.error('Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, 10000);
  // server.close() -> worker.close() -> closeQueue()
}
```

### Job Progress Logging with Error Wrapping

Progress events try to serialize job data for logging. Serialization errors are caught and logged as warnings without crashing the worker:
```typescript
worker.on('progress', (job, progress) => {
  try {
    const logger = createJobLogger(job);
    logger.info(`Job ${job.id} progress: ${JSON.stringify(progress)}`);
  } catch (err) {
    const logger = createLogger({ component: 'worker' });
    logger.warn(`Job ${job?.id} progress serialization error: ${err}`);
  }
});
```

## Testing

Tests use Vitest with coverage reporting.

### Test Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint
```

### Testing Conventions

- Test files are co-located with source files using `.test.ts` suffix
- Tests must pass before committing
- All new code requires tests

## Project Structure

```
src/
  index.ts                - Application entry point, builds and starts server
  config/
    index.ts               - Loads configuration from environment variables
    index.test.ts          - Config tests
  types/
    index.ts               - Shared TypeScript interfaces
    index.test.ts          - Type tests
  utils/
    logger.ts              - Structured logging with pino
    logger.test.ts
    working-dir.ts         - Temp working directory utilities for git operations
    working-dir.test.ts
  server/
    index.ts               - Fastify server factory with graceful shutdown
    index.test.ts          - Server tests
    routes/
      health.ts            - GET /health endpoint
  jobs/
    index.ts               - Job infrastructure exports
    index.test.ts          - Job tests
    queue.ts               - BullMQ Queue and QueueEvents configuration
    worker.ts              - BullMQ Worker factory with logging middleware
    logger.ts              - Job-specific logging helper
    intake.ts              - Polling-based GitHub issue intake (repeatable job)
    prepare-run.ts         - Run bootstrap, branch setup, and workspace preparation
    assess.ts              - Stub-safe assessment stage
    plan.ts                - Stub-safe planning stage
    develop.ts             - Codex CLI executor stage
    quality-gate.ts        - Stub-safe quality gate stage
    review.ts              - Stub-safe review stage
    make-pr.ts             - Commit, push, and pull request creation
    sync-tracker-state.ts  - Post-PR tracker synchronization and cleanup
  github/
    index.ts               - GitHub API client exports
    types.ts               - GitHub-specific TypeScript types
    client.ts              - Octokit client factory
    issues.ts              - GitHub issues API functions
    branches.ts            - GitHub branches/ref API functions
    pullRequests.ts        - GitHub pull requests API functions
```

## Docker Redis

See `docs/docker.md` for Docker Compose details.

Quick reference:

```bash
./scripts/start.sh      # Start Redis and the dev server
./scripts/stop.sh       # Stop the dev server and Redis
docker-compose up -d    # Start Redis only
docker-compose down     # Stop Redis only
```

## License

MIT
