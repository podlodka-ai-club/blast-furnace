import { Worker, Job } from 'bullmq';
import { config } from '../config/index.js';
import type { JobData } from './queue.js';
import { createJobLogger } from './logger.js';

export interface WorkerOptions {
  concurrency?: number;
}

export function createWorker(
  processor: (job: Job<JobData>) => Promise<void>,
  options: WorkerOptions = {}
): Worker<JobData> {
  const worker = new Worker<JobData>('agent-orchestrator', processor, {
    connection: {
      host: config.redis.host,
      port: config.redis.port,
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
    const logger = createJobLogger(job);
    logger.info(`Job ${job.id} progress: ${JSON.stringify(progress)}`);
  });

  return worker;
}

export async function closeWorker(worker: Worker<JobData>): Promise<void> {
  await worker.close();
}
