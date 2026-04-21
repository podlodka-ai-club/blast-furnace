import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';

// Mock the config module with webhook strategy before importing buildServer
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
      issueStrategy: 'webhook',
      pollIntervalMs: 60000,
      webhookSecret: 'test-secret',
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

describe('buildServer with webhook strategy', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer({ logger: false });
  });

  afterEach(async () => {
    await server.close();
  });

  it('registers GitHub webhooks route when issueStrategy is webhook', async () => {
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
    // Should return 200 (or 401 if signature validation fails without proper signature header)
    expect([200, 401]).toContain(response.statusCode);
  });

  it('rejects webhook request without signature when webhookSecret is configured', async () => {
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
    // Without proper x-hub-signature-256 header, should return 401
    expect(response.statusCode).toBe(401);
  });
});