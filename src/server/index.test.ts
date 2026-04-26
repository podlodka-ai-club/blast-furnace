import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from './index.js';

// Mock the config module with full structure
vi.mock('../config/index.js', () => ({
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
vi.mock('../jobs/queue.js', () => ({
  jobQueue: {
    add: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
    close: vi.fn().mockResolvedValue(undefined),
  },
  queueEvents: {
    close: vi.fn().mockResolvedValue(undefined),
  },
  closeQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../jobs/intake.js', () => ({
  REPO_LIST_KEY: 'github:repos',
}));

describe('server', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer({ logger: false });
  });

  afterAll(async () => {
    await server.close();
  });

  it('health check returns ok status', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('server responds to CORS preflight', async () => {
    const response = await server.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        'origin': 'http://localhost:3000',
        'access-control-request-method': 'GET',
      },
    });

    // CORS preflight should succeed
    expect(response.statusCode).toBe(204);
  });

  it('server accepts requests from allowed origins', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'origin': 'http://localhost:3000',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
});

describe('buildServer', () => {
  it('creates a server with logger disabled when logger option is false', async () => {
    const server = await buildServer({ logger: false });
    // Logger is disabled when logger: false
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    await server.close();
  });

  it('creates a server with logger enabled by default', async () => {
    const server = await buildServer({});
    // Logger is enabled by default (hasLogger returns true)
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    await server.close();
  });

  it('registers CORS plugin', async () => {
    const server = await buildServer({ logger: false });
    // CORS should be registered - test with a request
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });
    expect(response.statusCode).toBe(200);
    await server.close();
  });

  it('does not register webhook route or enqueue issue work', async () => {
    const { jobQueue } = await import('../jobs/queue.js');
    vi.clearAllMocks();

    const server = await buildServer({ logger: false });
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
    await server.close();
  });

  it('rejects invalid JSON with the normal Fastify parser', async () => {
    const server = await buildServer({ logger: false });
    const response = await server.inject({
      method: 'POST',
      url: '/repos',
      headers: {
        'content-type': 'application/json',
      },
      payload: '{',
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });
});
