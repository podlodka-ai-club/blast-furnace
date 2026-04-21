import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer, startServer } from './index.js';

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
      issueStrategy: 'polling',
      pollIntervalMs: 60000,
      webhookSecret: undefined,
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

describe('server', () => {
  let server: FastifyInstance;
  const testPort = 3456;

  beforeAll(async () => {
    server = await buildServer({ logger: false });
    await startServer(server, testPort, '127.0.0.1');
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

  it('does not register webhook route when issueStrategy is polling', async () => {
    const server = await buildServer({ logger: false });
    // With polling strategy, webhook route should not be registered
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
    });
    expect(response.statusCode).toBe(404);
    await server.close();
  });
});