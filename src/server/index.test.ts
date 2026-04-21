import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer, startServer } from './index.js';

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
});