import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';

vi.mock('../../config/index.js', () => ({
  config: {
    env: 'test',
    port: 3000,
    redis: {
      host: 'localhost',
      port: 6379,
      password: undefined,
    },
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
      pollIntervalMs: 60000,
    },
  },
}));

// Mock the job queue to avoid Redis connection
vi.mock('../../jobs/queue.js', () => ({
  jobQueue: {
    add: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
    close: vi.fn().mockResolvedValue(undefined),
  },
  queueEvents: {
    close: vi.fn().mockResolvedValue(undefined),
  },
  closeQueue: vi.fn().mockResolvedValue(undefined),
}));

// Import buildServer after mocks are set up
import { buildServer } from '../index.js';

describe('buildServer without webhook intake', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer({ logger: false });
  });

  afterEach(async () => {
    await server.close();
  });

  it('does not register GitHub webhooks route', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: {
        action: 'opened',
        issue: {
          id: 123,
          number: 1,
          title: 'Test Issue',
          body: 'Test body',
        },
      },
    });
    expect(response.statusCode).toBe(404);
  });

  it('does not enqueue issue processing work for webhook-shaped requests', async () => {
    const { jobQueue } = await import('../../jobs/queue.js');
    vi.clearAllMocks();

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: {
        action: 'opened',
        issue: {
          id: 123,
          number: 1,
          title: 'Test Issue',
          body: 'Test body',
        },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(jobQueue.add).not.toHaveBeenCalled();
  });
});
