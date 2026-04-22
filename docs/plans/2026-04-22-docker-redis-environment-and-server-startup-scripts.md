# Docker Redis Environment and Server Startup Script

## Overview

Create a Docker Compose environment for Redis and scripts to start/stop the server with Docker-hosted Redis.

## Context

- Files involved: package.json, src/index.ts, src/config/index.ts
- Related patterns: BullMQ already uses ioredis with host/port from config
- Dependencies: Docker, Docker Compose (must be installed on host)

## Development Approach

- Testing approach: Regular (code first, then tests)
- Complete each task fully before moving to the next
- No new tests required for Docker/shell script configuration changes

## Implementation Steps

### Task 1: Create Docker Compose configuration for Redis

**Files:**
- Create: `docker-compose.yml`

- [x] Add Redis service with port 6379 exposed to host
- [x] Add healthcheck to verify Redis is ready
- [x] Use redis:7-alpine image for small footprint

### Task 2: Create server startup script

**Files:**
- Create: `scripts/start.sh`

- [x] Check if Docker is running
- [x] Start Redis via docker-compose up -d
- [x] Wait for Redis healthcheck to pass
- [x] Start the Node.js server via npm run dev

### Task 3: Create server stop script

**Files:**
- Create: `scripts/stop.sh`

- [x] Stop the Node.js server (kill background process)
- [x] Stop Redis via docker-compose down

### Task 4: Verify the setup works

- [x] Run docker-compose up -d and verify Redis starts
- [x] Run the start script and verify server connects to Redis
- [x] Run the stop script and verify clean shutdown
- [x] Run existing tests to ensure nothing broke

### Task 5: Update documentation

**Files:**
- Create: `docs/docker.md` (Docker usage guide)
- Modify: `CLAUDE.md` (if needed)

- [ ] Document Docker Compose commands
- [ ] Document start/stop script usage
- [ ] Update CLAUDE.md with Docker setup notes
- [ ] Move this plan to `docs/plans/completed/`