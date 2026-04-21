import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Job } from 'bullmq';
import type { WorkerOptions, JobData } from './index.js';

// Mock the config module
vi.mock('../config/index.js', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
    },
  },
}));

describe('job queue', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should export jobQueue with correct name', async () => {
    const { jobQueue } = await import('./index.js');
    expect(jobQueue.name).toBe('agent-orchestrator');
  });

  it('should export queueEvents', async () => {
    const { queueEvents } = await import('./index.js');
    expect(queueEvents).toBeDefined();
  });
});

describe('job logger', () => {
  it('should create a logger with job context', async () => {
    const { createJobLogger } = await import('./logger.js');

    const mockJob = {
      id: 'job-123',
      data: {
        taskId: 'task-456',
        type: 'test-task',
      },
    } as unknown as Job;

    const logger = createJobLogger(mockJob);

    // Test that logger methods exist and can be called
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('should handle job with missing id', async () => {
    const { createJobLogger } = await import('./logger.js');

    const mockJob = {
      id: null,
      data: {
        taskId: 'task-456',
        type: 'test-task',
      },
    } as unknown as Job;

    const logger = createJobLogger(mockJob);
    expect(typeof logger.info).toBe('function');
  });
});

describe('worker creation', () => {
  it('should export createWorker function', async () => {
    const { createWorker } = await import('./index.js');
    expect(typeof createWorker).toBe('function');
  });

  it('should export closeWorker function', async () => {
    const { closeWorker } = await import('./index.js');
    expect(typeof closeWorker).toBe('function');
  });

  it('should export WorkerOptions type', async () => {
    // Type check - if this compiles, the type is exported correctly
    const options: WorkerOptions = { concurrency: 5 };
    expect(options.concurrency).toBe(5);
  });
});

describe('job data type', () => {
  it('should export JobData type', async () => {
    // Type check - if this compiles, the type is exported correctly
    const data: JobData = {
      taskId: 'test-task',
      type: 'test',
      payload: { key: 'value' },
    };
    expect(data.taskId).toBe('test-task');
  });
});
