import { Worker, Job } from 'bullmq';
import { config } from '../config/index.js';
import type { JobPayload } from '../types/index.js';
import { createLogger } from '../utils/logger.js';
import { createJobLogger } from './logger.js';

export interface WorkerOptions {
  concurrency?: number;
}

export function createWorker(
  processor: (job: Job<JobPayload>) => Promise<void>,
  options: WorkerOptions = {}
): Worker<JobPayload> {
  const worker = new Worker<JobPayload>('agent-orchestrator', processor, {
    connection: {
      host: config.redis.host,
      port: config.redis.port,
      ...(config.redis.password && { password: config.redis.password }),
    },
    concurrency: options.concurrency ?? 5,
  });

  // Add logging middleware
  worker.on('active', (job) => {
    const logger = createJobLogger(job);
    logger.info(`Job ${job.id} started processing`);
  });

  worker.on('completed', (job) => {
    const logger = createJobLogger(job);
    logger.info(`Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    if (!job) return;
    const logger = createJobLogger(job);
    logger.error(`Job ${job.id} failed: ${err.message}`);
  });

  worker.on('progress', (job, progress) => {
    try {
      const logger = createJobLogger(job);
      logger.info(`Job ${job.id} progress: ${JSON.stringify(progress)}`);
    } catch {
      // Progress data may contain circular references or other serialization issues
    }
  });

  worker.on('stalled', (jobId) => {
    const logger = createLogger({ component: 'worker' });
    logger.warn(`Job ${jobId} stalled and will be retried`);
  });

  worker.on('error', (err) => {
    const logger = createLogger({ component: 'worker' });
    logger.error(`Worker error: ${err.message}`);
  });

  return worker;
}

export async function closeWorker(worker: Worker<JobPayload>): Promise<void> {
  await worker.close();
}
