import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';

// Mock the config
vi.mock('../../config/index.js', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
      password: undefined,
    },
  },
}));

// Mock REPO_LIST_KEY from intake
vi.mock('../../jobs/intake.js', () => ({
  REPO_LIST_KEY: 'github:repos',
}));

// Create mock Redis client
const mockRedisClient = {
  sadd: vi.fn(),
  srem: vi.fn(),
  smembers: vi.fn(),
  status: 'ready',
};

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => mockRedisClient),
}));

// Import after mocks are set up
import { reposUIRoute } from './repos-ui.js';
import { setRedisClient } from './repos.js';

describe('reposUIRoute', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.resetAllMocks();
    server = Fastify({ logger: false });
    setRedisClient(mockRedisClient as unknown as Redis);
    await server.register(reposUIRoute);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe('GET /', () => {
    it('should return HTML page with correct content-type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
    });

    it('should include form elements in HTML', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      const html = response.body;
      expect(html).toContain('<form id="addRepoForm"');
      expect(html).toContain('id="owner"');
      expect(html).toContain('id="repo"');
      expect(html).toContain('type="submit"');
    });

    it('should include repository list container', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      const html = response.body;
      expect(html).toContain('id="repoList"');
      expect(html).toContain('id="emptyState"');
    });

    it('should include JavaScript for form handling', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      const html = response.body;
      expect(html).toContain('addEventListener');
      expect(html).toContain('fetchRepos');
      expect(html).toContain('removeRepo');
    });

    it('should include styling', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      const html = response.body;
      expect(html).toContain('<style>');
      expect(html).toContain('.card');
      expect(html).toContain('.form-group');
    });

    it('should inject API base URL into page', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      const html = response.body;
      expect(html).toContain('data-api-base');
    });

    it('should return complete HTML document', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      const html = response.body;
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
      expect(html).toContain('<head>');
      expect(html).toContain('</head>');
      expect(html).toContain('<body');
      expect(html).toContain('</body>');
    });

    it('should have proper title', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      const html = response.body;
      expect(html).toContain('<title>Repository Polling</title>');
    });
  });
});

describe('reposUIRoute with custom apiBaseUrl', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.resetAllMocks();
    server = Fastify({ logger: false });
    await server.register(reposUIRoute, { apiBaseUrl: '/custom/api' });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should use custom API base URL when provided', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/',
    });

    const html = response.body;
    expect(html).toContain('data-api-base="/custom/api"');
  });
});
