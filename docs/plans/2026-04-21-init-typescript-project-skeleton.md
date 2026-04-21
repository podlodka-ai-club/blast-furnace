# Init TypeScript Project Skeleton for Agent Orchestrator Server

## Overview

Set up a TypeScript project skeleton for the Agent Orchestrator server that runs continuously, polls GitHub Issues, and processes tasks through a pipeline using background jobs. The server will be built in the `src/` directory.

## Context

- This is the foundation for an Agent Orchestrator system that runs continuously as a server
- Polls GitHub Issues for tasks and processes them through pipeline stages using background jobs
- Language: TypeScript (confirmed)
- HTTP Framework: Fastify (modern, fast, excellent TypeScript support)
- Background Jobs: BullMQ (robust Redis-based job queue)
- Project state: Empty `src/` directory, no existing code

## Development Approach

- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Initialize TypeScript project configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`

- [x] Create `package.json` with dependencies: fastify, @fastify/cors, bullmq, ioredis, typescript, vitest, @types/node, tsx
- [x] Create `tsconfig.json` with strict mode, Node.js target, ESNext modules
- [x] Create `tsconfig.build.json` for production builds
- [x] Add npm scripts: build, dev, test, test:watch, lint
- [x] Write tests for config loading
- [x] Run tests - must pass

### Task 2: Set up Fastify HTTP server

**Files:**
- Create: `src/server/index.ts`
- Create: `src/server/routes/health.ts`
- Create: `src/server/plugins/`

- [x] Create Fastify server with TypeScript strict typing
- [x] Add health check route GET /health
- [x] Add graceful shutdown handling
- [x] Configure CORS plugin
- [x] Write tests for server startup/shutdown
- [x] Run tests - must pass

### Task 3: Set up BullMQ background job infrastructure

**Files:**
- Create: `src/jobs/queue.ts`
- Create: `src/jobs/worker.ts`
- Create: `src/jobs/processors/`

- [x] Create BullMQ Queue instance for job processing
- [x] Create Worker base setup
- [x] Add job retry configuration
- [x] Add job logging middleware
- [x] Write tests for queue/worker initialization
- [x] Run tests - must pass

### Task 4: Create src directory structure

**Files:**
- Create: `src/types/`
- Create: `src/config/`
- Create: `src/utils/`

- [x] Create `src/types/index.ts` for shared TypeScript interfaces
- [x] Create `src/config/index.ts` for environment config loading
- [x] Create `src/utils/logger.ts` for structured logging
- [x] Write tests for config and types
- [x] Run tests - must pass

### Task 5: Verify project builds and runs

- [ ] Run TypeScript build (npm run build)
- [ ] Run linter (npm run lint)
- [ ] Run full test suite
- [ ] Verify server starts in dev mode (npm run dev)

### Task 6: Update documentation

- [ ] Update README.md with project setup instructions
- [ ] Update CLAUDE.md with project structure and conventions
- [ ] Move this plan to `docs/plans/completed/`
