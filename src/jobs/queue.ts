import { Queue, QueueEvents } from 'bullmq';
import { config } from '../config/index.js';

export interface JobData {
  taskId: string;
  type: string;
  payload?: Record<string, unknown>;
}

export const jobQueue = new Queue<JobData>('agent-orchestrator', {
  connection: {
    host: config.redis.host,
    port: config.redis.port,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 60 * 60,
    },
    removeOnFail: {
      count: 500,
      age: 7 * 24 * 60 * 60,
    },
  },
});

export const queueEvents = new QueueEvents('agent-orchestrator', {
  connection: {
    host: config.redis.host,
    port: config.redis.port,
  },
});
