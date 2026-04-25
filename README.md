# Blast Furnace

Agent Orchestrator server that receives GitHub Issues via polling or webhooks (configurable) and processes tasks through background jobs using BullMQ.

## Overview

Blast Furnace is a continuous-running server that watches a GitHub repository for new issues using either polling or webhook delivery. When an issue is received, it is queued for processing, which logs the issue details, creates a new branch based on the issue, and opens a pull request.

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
| `GITHUB_ISSUE_STRATEGY` | polling | How to receive issues: `polling` or `webhook` |
| `GITHUB_POLL_INTERVAL_MS` | 60000 | Polling interval in milliseconds (minimum 1000) |
| `GITHUB_WEBHOOK_SECRET` | (none) | HMAC secret for webhook signature validation (optional) |
| `CODEX_CLI_PATH` | `npx @openai/codex` | Command used to launch Codex CLI |
| `CODEX_TIMEOUT_MS` | 300000 | Codex CLI timeout in milliseconds |

## Architecture

### Operating Model

The orchestrator is built as a queue-driven pipeline. Each major stage runs as a BullMQ job, persists its input as JSON-compatible `job.data`, and schedules the next stage by adding another job to the queue. Stages do not call each other directly.

Redis is the shared persistence layer behind this model:
- BullMQ stores queued jobs, retry state, and stage payloads in Redis
- The application stores supporting state in Redis, such as the last poll timestamp and registered repositories

Current high-level flow:

```text
GitHub polling/webhook
  -> BullMQ queue
      -> issue-processor job
          -> BullMQ queue
              -> codex-provider job
                  -> commit/push/PR steps
```

For example, `issue-processor` receives a `GitHubIssue`, creates or verifies `issue-{number}-{slugified-title}`, then enqueues `codex-provider` with the same issue plus `branchName`. If a worker is available, BullMQ may run the next job almost immediately; otherwise it remains queued until worker capacity is available.

### HTTP Framework

Fastify v5 is used as the HTTP framework due to its performance and TypeScript compatibility.

### Issue Reception

Issues are received via one of two strategies:
- **Polling**: A repeatable job periodically fetches open issues from GitHub
- **Webhook**: GitHub sends webhook events to the server's `/webhooks/github` endpoint

### Background Job Processing

BullMQ v5 with Redis provides the background job infrastructure:

- **Retry Policy**: 3 attempts with exponential backoff (1s initial delay)
- **Concurrency**: 5 jobs processed simultaneously
- **Cleanup**: Completed jobs removed after 100 jobs or 24 hours; failed jobs removed after 500 jobs or 7 days

The current job flow is:

1. Issue reception
2. Job queue
3. Issue processor: logs issue details, creates or reuses `issue-{number}-{slugified-title}`, then enqueues Codex
4. Codex provider: clones the repo into a temp directory, checks out the issue branch, runs Codex CLI, commits and pushes changes if present, opens a PR, then attempts to update labels

## Features

### Issue Reception

Two strategies for receiving GitHub issues:

**Polling (default)**
- A repeatable job runs on a configurable interval (default: 60 seconds)
- The last poll timestamp is stored in Redis, not in job data (which is static for repeatable jobs)
- On first run, all open issues are fetched; subsequent runs fetch only issues updated since last poll

**Webhook**
- POST /webhooks/github receives issue events from GitHub
- Route is only registered when `GITHUB_ISSUE_STRATEGY=webhook` (conditional registration)
- Signature validation uses HMAC SHA256 with timing-safe comparison to prevent attacks

### Issue Processing

When an issue is queued:

1. The issue is logged
2. A branch is created or reused: `issue-{number}-{slugified-title}`
3. A `codex-provider` job is enqueued
4. Codex CLI is run with the issue title and body as the prompt
5. If Codex changes files, the job commits, pushes, creates a PR with body `Closes #{number}`, and attempts to replace `ready` with `in review`
6. If Codex makes no changes, commit, push, and PR creation are skipped

### API Endpoints

**GET /health**

- Returns server health status with timestamp and uptime in seconds
- Response: `{ "status": "ok", "timestamp": "2026-04-22T00:00:00.000Z", "uptime": 1234 }`

**POST /webhooks/github**

- Registered only when `GITHUB_ISSUE_STRATEGY=webhook`
- Receives GitHub webhook events
- Validates HMAC signature if `GITHUB_WEBHOOK_SECRET` is configured
- Queues `issues.opened` payloads for async processing and returns 200 immediately
- Request body must include `action` and `issue` fields

**GET /repos**

- Lists repositories registered for polling
- Response: `{ "repos": [...], "total": 1 }`

**POST /repos**

- Adds a repository to the Redis-backed polling list
- Request body: `{ "owner": "octocat", "repo": "hello-world" }`
- Returns 201 on success, 409 when already registered

**DELETE /repos/:owner/:repo**

- Removes a repository from the polling list
- Returns 200 on success, 404 when the repository is not registered

**GET /repos/manage**

- Serves a small HTML UI for adding, listing, and removing repositories in the polling list

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
    case 'issue-processor':
      return issueProcessorHandler(job as Job<IssueProcessorJobData>);
    case 'issue-watcher':
      return issueWatcherHandler(job as Job<IssueWatcherJobData>);
    case 'codex-provider':
      return codexProviderHandler(job as Job<CodexProviderJobData>);
    default:
      throw new Error(`Unknown job type: ${job.data.type}`);
  }
}
```

### Repeatable Jobs and Redis Timestamp Storage

BullMQ repeatable jobs have static job data. To track dynamic state (last poll time), the issue watcher stores the timestamp in Redis:
```typescript
const LAST_POLL_KEY = 'github:issue-watcher:last-poll';
// Store after fetching
await redisClient.set(LAST_POLL_KEY, new Date().toISOString());
// Read before fetching
const lastPollTimestamp = await redisClient.get(LAST_POLL_KEY);
```

### Conditional Webhook Route Registration

The webhook route is only registered when the webhook strategy is configured:

```typescript
if (config.github.issueStrategy === 'webhook') {
  await server.register(githubWebhooksRoute);
}
```

### HMAC Timing-Safe Validation

Webhook signatures are validated using `crypto.timingSafeEqual`:
```typescript
function validateSignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(signatureBuffer, expectedBuffer);
}
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
      github-webhooks.ts   - POST /webhooks/github for GitHub issue events
  jobs/
    index.ts               - Job infrastructure exports
    index.test.ts          - Job tests
    queue.ts               - BullMQ Queue and QueueEvents configuration
    worker.ts              - BullMQ Worker factory with logging middleware
    logger.ts              - Job-specific logging helper
    issue-watcher.ts        - Polling-based GitHub issue watcher (repeatable job)
    issue-processor.ts      - Issue processing job (logs issue, creates branch and PR)
  github/
    index.ts               - GitHub API client exports
    types.ts               - GitHub-specific TypeScript types
    client.ts              - Octokit client factory
    issues.ts              - GitHub issues API functions
    branches.ts            - GitHub branches/ref API functions
    pullRequests.ts        - GitHub pull requests API functions

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
