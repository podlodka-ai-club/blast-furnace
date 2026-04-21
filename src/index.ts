import { buildServer, startServer } from './server/index.js';
import { config } from './config/index.js';
import { closeQueue, closeWorker, createWorker } from './jobs/index.js';
import type { Job, Worker } from 'bullmq';
import type { JobPayload } from './types/index.js';

let server: Awaited<ReturnType<typeof buildServer>> | undefined;
let worker: Worker<JobPayload> | undefined;
let isShuttingDown = false;

// Placeholder processor - worker infrastructure is ready for task processing
async function placeholderProcessor(_job: Job<JobPayload>): Promise<void> {
  // Tasks will be processed here in future implementation
}

async function main(): Promise<void> {
  // Validate required configuration
  if (!config.github.token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }
  if (!config.github.owner) {
    throw new Error('GITHUB_OWNER environment variable is required');
  }
  if (!config.github.repo) {
    throw new Error('GITHUB_REPO environment variable is required');
  }

  server = await buildServer({ logger: true });
  await startServer(server, config.port);

  // Create worker after server is ready
  worker = createWorker(placeholderProcessor);
}

// Handle shutdown signals - coordinated shutdown with guard
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log(`Received ${signal}, shutting down gracefully...`);

  const timeout = setTimeout(() => {
    console.error('Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, 10000);
  timeout.unref();

  let shutdownError: Error | undefined;

  try {
    // Close server first to stop accepting new connections
    if (server) {
      await server.close();
    }
  } catch (err) {
    shutdownError = err instanceof Error ? err : new Error(String(err));
    console.error('Error closing server:', shutdownError);
  }
  try {
    // Close worker if it was created
    if (worker) {
      await closeWorker(worker);
    }
  } catch (err) {
    shutdownError = err instanceof Error ? err : new Error(String(err));
    console.error('Error closing worker:', shutdownError);
  }
  try {
    // Close queue events and queue
    await closeQueue();
  } catch (err) {
    shutdownError = err instanceof Error ? err : new Error(String(err));
    console.error('Error closing queue:', shutdownError);
  }

  clearTimeout(timeout);
  process.exit(shutdownError ? 1 : 0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
