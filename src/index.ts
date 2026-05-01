import { buildServer, startServer } from './server/index.js';
import { config } from './config/index.js';
import { closeQueue, closeWorker, createWorker } from './jobs/index.js';
import { intakeHandler, startIntake, closeIntakeRedis } from './jobs/intake.js';
import { prepareRunHandler } from './jobs/prepare-run.js';
import { assessHandler } from './jobs/assess.js';
import { planHandler } from './jobs/plan.js';
import { developHandler } from './jobs/develop.js';
import { reviewHandler } from './jobs/review.js';
import { makePrHandler } from './jobs/make-pr.js';
import { syncTrackerStateHandler } from './jobs/sync-tracker-state.js';
import { prReworkIntakeHandler } from './jobs/pr-rework-intake.js';
import type { Job, Worker } from 'bullmq';
import type {
  AssessJobData,
  DevelopJobData,
  IntakeJobData,
  JobPayload,
  MakePrJobData,
  PlanJobData,
  PrReworkIntakeJobData,
  PrepareRunJobData,
  ReviewJobData,
  SyncTrackerStateJobData,
} from './types/index.js';

let server: Awaited<ReturnType<typeof buildServer>> | undefined;
let worker: Worker<JobPayload> | undefined;
let isShuttingDown = false;

/**
 * Multi-handler that routes jobs to appropriate handlers based on job type
 */
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
    case 'review':
      return reviewHandler(job as Job<ReviewJobData>);
    case 'make-pr':
      return makePrHandler(job as Job<MakePrJobData>);
    case 'sync-tracker-state':
      return syncTrackerStateHandler(job as Job<SyncTrackerStateJobData>);
    case 'pr-rework-intake':
      return prReworkIntakeHandler(job as Job<PrReworkIntakeJobData>);
    default:
      throw new Error(`Unknown job type: ${job.data.type}`);
  }
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

  await startIntake();

  // Create worker after server is ready
  worker = createWorker(multiHandler);
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
  try {
    // Close intake Redis client
    await closeIntakeRedis();
  } catch (err) {
    shutdownError = err instanceof Error ? err : new Error(String(err));
    console.error('Error closing intake Redis:', shutdownError);
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
