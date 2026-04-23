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
   export GITHUB_TOKEN=your_github_token
   export GITHUB_OWNER=owner
   export GITHUB_REPO=repo
   ```

3. Start Redis:
   ```bash
   redis-server
   ```

4. Run in development mode:
   ```bash
   npm run dev
   ```

## Configuration

All configuration is loaded from environment variables.

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

## Architecture

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

The job flow is linear: Issue Reception -> Job Queue -> Issue Processor (logs issue, creates branch, opens PR).

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

When an issue is received:
1. The issue is logged (title, body, number)
2. A branch is created: `issue-{number}-{slugified-title}`
3. A pull request is opened with the issue body as the PR body

### API Endpoints

**GET /health**
- Returns server health status with timestamp and uptime in seconds
- Response: `{ "status": "ok", "timestamp": "2026-04-22T00:00:00.000Z", "uptime": 1234 }`

**POST /webhooks/github**
- Receives GitHub webhook events
- Validates HMAC signature if `GITHUB_WEBHOOK_SECRET` is configured
- Only processes `issues.opened` events
- Queues the issue for async processing and returns 200 immediately
- Request body must include `action` and `issue` fields

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
```

## License

MIT
