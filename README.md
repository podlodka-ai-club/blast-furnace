# Blast Furnace

Agent Orchestrator server that polls one configured GitHub repository for issues and processes them through a BullMQ-backed workflow.

## Overview

Blast Furnace runs continuously, polls the repository configured by `GITHUB_OWNER` and `GITHUB_REPO` for open issues labeled `ready`, and turns each accepted issue into a run. A run prepares an issue branch and workspace, executes the target workflow, runs Codex in the prepared workspace, and either opens a pull request or finishes as a no-change run.

The current runtime is intentionally single-repository and polling-only. Webhook intake and Redis-backed repository registry routes are not part of the active server surface.

## Prerequisites

- Node.js >= 20.0.0
- Redis server for BullMQ
- Git
- Docker Compose, if using the bundled Redis startup scripts

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

All application configuration is loaded from environment variables. For local development, keep values in `.env.local` using shell `export` syntax and load them with `source ./scripts/load-env.sh`.

### Required Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token used for issue, branch, PR, label, and clone/push operations |
| `GITHUB_OWNER` | Single repository owner, user, or organization |
| `GITHUB_REPO` | Single repository name |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `3000` | HTTP server port |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | (none) | Redis password |
| `CORS_ORIGIN` | `true` | CORS allowed origins, comma-separated list or `*` for all |
| `GITHUB_POLL_INTERVAL_MS` | `60000` | Intake polling interval in milliseconds, minimum `1000` |
| `CODEX_CLI_PATH` | `npx @openai/codex` | Command used to launch Codex CLI |
| `CODEX_MODEL` | `gpt-5.4` | Model passed to Codex CLI with `--model` when the CLI path does not already specify a model |
| `CODEX_TIMEOUT_MS` | `300000` | Codex CLI timeout in milliseconds, capped at 10 minutes |
| `ORCHESTRATION_STORAGE_ROOT` | current process working directory | Root where `.orchestrator/runs/...` run files are written |

Legacy `GITHUB_ISSUE_STRATEGY` and `GITHUB_WEBHOOK_SECRET` values are ignored by the current runtime.

## Architecture

### Operating Model

The orchestrator is a queue-driven workflow. BullMQ carries transport payloads, retries jobs, and schedules stage transitions. Durable business handoff after `prepare-run` is stored in run-scoped JSONL files under the Blast Furnace repository, not in the cloned target repository workspace.

Current flow:

```text
GitHub polling intake
  -> intake
  -> prepare-run
  -> assess
  -> plan
  -> develop
  -> quality-gate
  -> review
  -> make-pr
  -> sync-tracker-state, only after a pull request is created
```

No-change runs terminate in `make-pr` after workspace cleanup. Pull-request runs terminate in `sync-tracker-state` after tracker synchronization and workspace cleanup.

### Intake

Startup always schedules the repeatable `intake` job with job id `intake-repeatable`. Intake reads the last valid poll timestamp from Redis key `github:intake:last-poll`, falls back to the legacy `github:issue-watcher:last-poll` key when present, and fetches open GitHub issues labeled `ready`.

For each issue, Intake creates a `prepare-run` payload with a new `runId`, the configured repository identity, `stageAttempt: 1`, and `reworkAttempt: 0`. A Redis processing lock prevents repeated polling from enqueueing the same issue concurrently.

### Single Repository

`GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_TOKEN` are the only production repository selection mechanism. Runtime intake ignores old `github:repos` Redis registry data. Downstream GitHub and git side-effect stages validate the repository identity from the run before creating branches, checking changes, pushing, opening pull requests, or moving labels.

### Run Handoff Files

`prepare-run` initializes a timestamped run file set:

```text
<ORCHESTRATION_STORAGE_ROOT>/.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/
  <YYYY-MM-DD_HH.MM_runId>_run.json
  <YYYY-MM-DD_HH.MM_runId>_handoff.jsonl
```

The timestamp is computed once in UTC and persisted in the run summary. `run.json` is mutable status and pointer state: current stage, run status, stage attempt summaries, counters, and the latest handoff record reference.

The handoff JSONL file is the durable source of stage outputs. Each line is one validated record with `recordId`, `sequence`, `runId`, `fromStage`, `toStage`, `stageAttempt`, `reworkAttempt`, `dependsOn`, `status`, `output`, and `nextInput`.

After `prepare-run`, stage queue payloads are intentionally transport-only:

```typescript
{
  type: 'plan',
  runId: '...',
  stage: 'plan',
  stageAttempt: 1,
  reworkAttempt: 0,
  inputRecordRef: {
    runDir: '...',
    handoffPath: '...',
    recordId: '000002_assess_to_plan',
    sequence: 2,
    stage: 'assess',
  },
}
```

Stages validate the incoming payload, read and validate the referenced handoff record, produce a typed output, append the next JSONL record, update `run.json`, and then enqueue the next job.

### Background Job Processing

BullMQ v5 with Redis provides:

- Retry policy: 3 attempts with exponential backoff, starting at 1 second
- Concurrency: 5 jobs processed simultaneously
- Cleanup: completed jobs removed after 100 jobs or 24 hours; failed jobs removed after 500 jobs or 7 days

`stageAttempt` and `reworkAttempt` are domain counters carried in run contracts. BullMQ retry attempts are infrastructure retry state and are not treated as stage attempts.

### Stage Responsibilities

| Stage | Responsibility |
|-------|----------------|
| `intake` | Poll the configured repository for open `ready` issues and enqueue `prepare-run` |
| `prepare-run` | Create run identity and files, create or reuse `issue-{number}-{slugified-title}`, clone the repository, check out/reset the issue branch, append the first handoff record |
| `assess` | Stub-safe assessment stage; appends assessment output |
| `plan` | Stub-safe planning stage; appends plan output used by `develop` |
| `develop` | Runs Codex CLI in the prepared workspace via `node-pty` and appends development output |
| `quality-gate` | Stub-safe quality stage; appends passing quality output |
| `review` | Stub-safe review stage; appends review output |
| `make-pr` | Detects target-repo changes, commits, pushes, creates a PR, or records terminal no-change output |
| `sync-tracker-state` | Moves issue labels from `ready` to `in review` after PR creation and performs terminal workspace cleanup |

`make-pr` excludes `.orchestrator/**` from target repository status checks and staging so orchestration run files are never committed to the target repository.

## API Endpoints

**GET /health**

- Returns server health status with timestamp and uptime in seconds
- Response: `{ "status": "ok", "timestamp": "2026-04-22T00:00:00.000Z", "uptime": 1234 }`

No GitHub webhook endpoint or repository management API is registered in the current server.

## Implementation Details

### ESNext Modules

Import/export statements use `.js` extensions for local files:

```typescript
import { buildServer } from './server/index.js';
```

This is required for ESNext module resolution with TypeScript.

### Worker Routing

A single worker routes all job types in `src/index.ts`:

```typescript
export async function multiHandler(job: Job<JobPayload>): Promise<void> {
  switch (job.data.type) {
    case 'intake':
      return intakeHandler(job as Job<IntakeJobData>);
    case 'prepare-run':
      return prepareRunHandler(job as Job<PrepareRunJobData>);
    case 'assess':
      return assessHandler(job as Job<AssessJobData>);
    case 'plan':
      return planHandler(job as Job<PlanJobData>);
    case 'develop':
      return developHandler(job as Job<DevelopJobData>);
    case 'quality-gate':
      return qualityGateHandler(job as Job<QualityGateJobData>);
    case 'review':
      return reviewHandler(job as Job<ReviewJobData>);
    case 'make-pr':
      return makePrHandler(job as Job<MakePrJobData>);
    case 'sync-tracker-state':
      return syncTrackerStateHandler(job as Job<SyncTrackerStateJobData>);
    default:
      throw new Error(`Unknown job type: ${job.data.type}`);
  }
}
```

### Branch Names

Issue branch names are generated as `issue-{number}-{slugified-title}`. The title is lowercased, stripped to alphanumeric characters, spaces, and hyphens, collapsed into hyphen separators, and truncated to 50 characters on a hyphen boundary when possible.

Branch names are rejected when empty, containing `..`, starting with `-`, or containing whitespace.

### Codex Execution

`develop` reads the planned context from the handoff ledger, builds a prompt from the issue title, issue body, and plan output, and runs the configured Codex CLI command in the prepared workspace. If the configured command looks like a Codex command and no subcommand is present, `exec` is added automatically. The stage also adds `--dangerously-bypass-approvals-and-sandbox` and `--model <CODEX_MODEL>` unless already provided.

### Graceful Shutdown

Shutdown follows this order with a 10-second timeout:

1. Close the HTTP server
2. Close the worker
3. Close queue events and queue
4. Close the Intake Redis client

## Testing

Tests use Vitest with co-located `.test.ts` files.

```bash
npm test
npm run test:watch
npm run lint
npm run build
```

## Project Structure

```text
src/
  index.ts                - Application entry point, startup, worker routing, shutdown
  config/
    index.ts              - Environment configuration
  types/
    index.ts              - Shared runtime, GitHub, job, run, and handoff types
    node-pty.d.ts         - node-pty type declaration
  utils/
    logger.ts             - Structured logging with pino
    node-pty.ts           - node-pty helper executable handling
    working-dir.ts        - Temporary workspace and git remote utilities
  server/
    index.ts              - Fastify server factory
    routes/
      health.ts           - GET /health endpoint
  jobs/
    queue.ts              - BullMQ Queue and QueueEvents configuration
    worker.ts             - BullMQ Worker factory with logging middleware
    logger.ts             - Job-specific logging helper
    intake.ts             - Polling-based GitHub issue intake
    prepare-run.ts        - Run bootstrap, branch setup, clone, checkout, first handoff
    assess.ts             - Stub-safe assessment stage
    plan.ts               - Stub-safe planning stage
    develop.ts            - Codex CLI executor stage
    quality-gate.ts       - Stub-safe quality gate stage
    review.ts             - Stub-safe review stage
    make-pr.ts            - Commit, push, pull request, no-change terminal path
    sync-tracker-state.ts - Post-PR label synchronization and cleanup
    orchestration.ts      - Run file, JSONL ledger, and run summary helpers
    handoff-contracts.ts  - Runtime validation for payloads and stage outputs
    stage-payloads.ts     - Transport-only downstream stage payload helpers
  github/
    client.ts             - Octokit client factory
    issues.ts             - Configured-repository issue fetching
    branches.ts           - Branch ref helpers
    pullRequests.ts       - Pull request creation
    issue-labels.ts       - `ready` -> `in review` transition helpers
    repository.ts         - Configured repository identity and validation
```

## Docker Redis

See `docs/docker.md` for Docker Compose details.

```bash
./scripts/start.sh      # Start Redis and the dev server
./scripts/stop.sh       # Stop the dev server and Redis
docker-compose up -d    # Start Redis only
docker-compose down     # Stop Redis only
```

## License

MIT
