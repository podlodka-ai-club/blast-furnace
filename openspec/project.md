# Project Context

## Purpose
Blast Furnace is a continuously running agent orchestrator server. It receives work from GitHub Issues through polling intake and processes each issue through background jobs.

The current implementation focuses on a practical MVP:
- watch configured GitHub repositories for issues
- queue issue work through BullMQ
- create or reuse an issue branch
- run Codex CLI against a temporary working directory
- commit and push changes when Codex modifies files
- open a pull request that closes the source issue
- transition issue labels from `ready` to `in review` when possible

Longer-term product direction is an agent development pipeline with deterministic handoff artifacts, quality gates, review/rework loops, visible GitHub progress updates, and repository-safe execution boundaries.

## Tech Stack
- TypeScript with ESNext modules
- Node.js >= 20
- Fastify v5 for the HTTP server
- BullMQ v5 for background jobs
- Redis, via ioredis, for queues and watcher state
- Octokit REST for GitHub API access
- Codex CLI, launched as a subprocess, for AI-assisted implementation work
- node-pty for terminal subprocess support
- Vitest for tests
- ESLint v9 with typescript-eslint
- Docker Compose for local Redis

## Project Conventions

### Code Style
- Use strict TypeScript. The compiler enables `strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, and related safety checks.
- Use ESNext module syntax. Local TypeScript imports include `.js` extensions, for example `import { buildServer } from './server/index.js';`.
- Keep source under `src/`; generated build output goes to `dist/` and should not be edited by hand.
- Prefer explicit shared interfaces in `src/types/index.ts` for cross-module data contracts.
- Use pino-based structured logging helpers from `src/utils/logger.ts` and job-specific logging helpers from `src/jobs/logger.ts`.
- Avoid `any`; ESLint warns on explicit `any`.
- Unused function arguments should be prefixed with `_` when intentionally unused.
- Keep behavior deterministic in server, job, GitHub, and git orchestration code. Leave reasoning-heavy work to agent executors only where deterministic code is not practical.

### Architecture Patterns
- `src/index.ts` is the application entry point. It loads config, builds the Fastify server, starts polling intake, creates the queue worker, and owns graceful shutdown.
- Configuration is loaded from environment variables in `src/config/index.ts`; avoid reading environment variables directly elsewhere unless there is an established exception.
- HTTP routes live under `src/server/routes/` and are registered by the server factory in `src/server/index.ts`.
- Background job infrastructure lives in `src/jobs/`. The queue and queue events are configured in `queue.ts`, worker creation in `worker.ts`, and handlers are split by job type.
- A single BullMQ worker handles multiple job payload types through the `JobPayload` discriminated union and a switch-based `multiHandler`.
- GitHub API operations are isolated in `src/github/`, split by concern: client construction, issues, branches, pull requests, and label transitions.
- Temporary repository work happens through `src/utils/working-dir.ts`. Codex work should happen in an isolated temp directory, not directly in the orchestrator repository.
- Polling state that must change between BullMQ repeatable job executions is stored in Redis because repeatable job data is static.
- Git operations such as branch creation, commit, push, and PR creation are deterministic orchestrator responsibilities, not decisions left to the agent prompt.

### Testing Strategy
- Tests use Vitest and are co-located with source files using the `.test.ts` suffix.
- All new code should include focused tests for the changed behavior.
- Prefer unit tests for config parsing, route behavior, job handlers, GitHub helper functions, and utility modules.
- Mock external systems such as GitHub, Redis, BullMQ jobs, subprocesses, and filesystem-heavy flows when a true integration test is unnecessary.
- Run `npm test` before considering behavior complete.
- Run `npm run lint` for TypeScript and ESLint checks.
- Run `npm run build` when changes affect types, module boundaries, or generated declarations.

### Git Workflow
- Use issue-oriented branches. The orchestrator currently creates branches named `issue-{number}-{slugified-title}`.
- Branch names must be validated to avoid traversal, leading dashes, whitespace, and invalid empty names.
- Pull requests created by the orchestrator should include `Closes #{issueNumber}` in the body.
- The repository may have local uncommitted work. Do not revert unrelated changes.
- Commit, push, and PR creation should remain explicit deterministic steps handled by application code.

## Domain Context
- The domain is agent-assisted software development orchestration.
- GitHub Issues are the primary task intake mechanism.
- A task arrives through polling by the repeatable `issue-watcher` job.
- Repository polling can be configured through Redis-backed repository CRUD endpoints and the `/repos/manage` HTML UI.
- The current processing flow is issue intake, queueing, issue processor, Codex provider, optional commit/push/PR, then label transition.
- Important job payload types are `IssueWatcherJobData`, `IssueProcessorJobData`, `RepoWatcherJobData`, and `CodexProviderJobData`.
- The future pipeline direction is `Intake -> Assess -> Plan -> Develop -> Quality gate -> Review -> Draft PR -> Move to in review`.
- Future pipeline handoffs should be represented by durable artifacts rather than in-memory process state.
- When an issue is under-specified, the preferred future behavior is to comment with specific questions and stop rather than fabricate a low-confidence PR.

## Important Constraints
- Node.js 20 or newer is required.
- Redis is required for BullMQ queues and watcher state.
- The server is designed to run continuously and shut down gracefully.
- Worker retry policy is 3 attempts with exponential backoff.
- Worker concurrency defaults to 5.
- Completed and failed jobs should be cleaned up according to queue defaults.
- GitHub support is the current scope; GitLab and other trackers are out of scope.
- Secrets such as `GITHUB_TOKEN` and local environment files must not be committed.
- `GITHUB_POLL_INTERVAL_MS` has a minimum of 1000 milliseconds.
- Codex execution uses `CODEX_MODEL`, defaulting to `gpt-5.4`, and is bounded by `CODEX_TIMEOUT_MS`, defaulting to 300000 milliseconds.
- Agent execution should not directly own repository-level git actions; deterministic orchestrator code should own those actions.

## External Dependencies
- GitHub REST API, accessed through Octokit, for issues, branches, refs, labels, and pull requests.
- Redis for BullMQ queue state, repeatable jobs, queue events, and repository watcher state.
- Codex CLI, configured with `CODEX_CLI_PATH` and `CODEX_MODEL`, for AI-assisted implementation.
- Docker Compose for local Redis development.

## Commands
- `npm install` installs dependencies.
- `npm run dev` starts the development server with `tsx watch src/index.ts`.
- `npm test` runs Vitest once.
- `npm run test:watch` runs Vitest in watch mode.
- `npm run lint` runs ESLint over `src/**/*.ts`.
- `npm run build` compiles TypeScript through `tsconfig.build.json`.
- `./scripts/start.sh` loads `.env.local` when present, starts Redis, waits for Redis health, and starts the dev server.
- `./scripts/stop.sh` stops the dev server and Redis.
- `docker-compose up -d` starts Redis only.
- `docker-compose down` stops Redis only.

## Configuration
- `NODE_ENV`: defaults to `development`.
- `PORT`: defaults to `3000`.
- `REDIS_HOST`: defaults to `localhost`.
- `REDIS_PORT`: defaults to `6379`.
- `REDIS_PASSWORD`: optional.
- `GITHUB_TOKEN`: required for GitHub operations.
- `GITHUB_OWNER`: required target repository owner.
- `GITHUB_REPO`: required target repository name.
- `GITHUB_POLL_INTERVAL_MS`: defaults to `60000`.
- `CODEX_CLI_PATH`: defaults to `npx @openai/codex`.
- `CODEX_MODEL`: defaults to `gpt-5.4`.
- `CODEX_TIMEOUT_MS`: defaults to `300000`.
- `CORS_ORIGIN`: used by the server, defaulting to permissive development behavior.
