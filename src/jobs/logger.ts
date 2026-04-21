import { Job } from 'bullmq';
import type { JobData } from './queue.js';

export interface JobLogger {
  info(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

export function createJobLogger(job: Job<JobData>): JobLogger {
  const jobId = job.id ?? 'unknown';
  const taskId = job.data.taskId;

  return {
    info(message: string): void {
      console.log(`[Job:${jobId}|${taskId}] INFO: ${message}`);
    },
    error(message: string): void {
      console.error(`[Job:${jobId}|${taskId}] ERROR: ${message}`);
    },
    warn(message: string): void {
      console.warn(`[Job:${jobId}|${taskId}] WARN: ${message}`);
    },
    debug(message: string): void {
      console.debug(`[Job:${jobId}|${taskId}] DEBUG: ${message}`);
    },
  };
}
