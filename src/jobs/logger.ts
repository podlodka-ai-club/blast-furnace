import { Job } from 'bullmq';
import type { JobPayload } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

export interface JobLogger {
  info(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

export function createJobLogger(job: Job<JobPayload>): JobLogger {
  const jobId = job.id ?? 'unknown';
  const taskId = job.data?.taskId ?? 'unknown';
  const logger = createLogger({ jobId, taskId, component: 'worker' });

  return {
    info(message: string): void {
      logger.info(message);
    },
    error(message: string): void {
      logger.error(message);
    },
    warn(message: string): void {
      logger.warn(message);
    },
    debug(message: string): void {
      logger.debug(message);
    },
  };
}
