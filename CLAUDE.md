# Project Context for Claude Code

## Project Overview

Blast Furnace is an Agent Orchestrator server that runs continuously, polls GitHub Issues, and processes tasks through a pipeline using background jobs.

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
  jobs/
    index.ts         - Job infrastructure exports
    index.test.ts    - Job tests
    queue.ts         - BullMQ Queue and QueueEvents configuration
    worker.ts        - BullMQ Worker factory with logging middleware
    logger.ts        - Job-specific logging helper
```

## Key Interfaces

Defined in `src/types/index.ts`:
- `TaskData`, `TaskResult`, `TaskStatus`
- `PipelineStage`, `StageResult`
- `AgentConfig`, `AgentResult`
- `GitHubIssue`, `GitHubComment`
- `AppConfig`, `RedisConfig`, `GitHubConfig`
- `JobPayload`

## Configuration

Loaded from environment variables in `src/config/index.ts`:
- `NODE_ENV` (default: development)
- `PORT` (default: 3000)
- `REDIS_HOST` (default: localhost)
- `REDIS_PORT` (default: 6379)
- `REDIS_PASSWORD` (optional, no default)
- `CORS_ORIGIN` (default: true for development)
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`

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
