# Blast Furnace

Agent Orchestrator server that polls GitHub Issues and processes tasks through a pipeline using background jobs.

## Prerequisites

- Node.js >= 20.0.0
- Redis server (for BullMQ job queue)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   # Set required environment variables
   export GITHUB_TOKEN=your_github_token
   export GITHUB_OWNER=owner
   export GITHUB_REPO=repo
   ```

   Optional environment variables:
   - `PORT` - HTTP server port (default: 3000)
   - `REDIS_HOST` - Redis host (default: localhost)
   - `REDIS_PORT` - Redis port (default: 6379)
   - `REDIS_PASSWORD` - Redis password (optional)
   - `CORS_ORIGIN` - CORS allowed origins, comma-separated list or `*` for all (default: true for development)
   - `NODE_ENV` - Environment (development/production)

3. Start Redis:
   ```bash
   redis-server
   ```

4. Build the project:
   ```bash
   npm run build
   ```

## Development

Run in development mode with hot reload:
```bash
npm run dev
```

Run tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

Lint code:
```bash
npm run lint
```

Build for production:
```bash
npm run build
```

## Project Structure

```
src/
  index.ts           - Application entry point
  config/            - Configuration loading from environment
  types/             - Shared TypeScript interfaces
  utils/
    logger.ts        - Structured logging utility
  server/
    index.ts         - Fastify server setup
    routes/
      health.ts      - Health check endpoint
  jobs/
    queue.ts         - BullMQ queue configuration
    worker.ts        - BullMQ worker setup
    logger.ts        - Job-specific logging
```

## API Endpoints

- `GET /health` - Health check endpoint

## Architecture

- **HTTP Framework**: Fastify (modern, fast, TypeScript-friendly)
- **Background Jobs**: BullMQ with Redis
- **Pipeline Stages**: fetch -> analyze -> execute -> report

## License

MIT
