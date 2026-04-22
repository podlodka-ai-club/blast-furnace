import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';

// Mock the config first
vi.mock('../../config/index.js', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
      password: undefined,
    },
  },
}));

// Mock REPO_LIST_KEY from issue-watcher
vi.mock('../../jobs/issue-watcher.js', () => ({
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
import {
  addRepo,
  listRepos,
  removeRepo,
  repoExists,
  setRedisClient,
} from './repos.js';

describe('repos module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setRedisClient(mockRedisClient as unknown as Redis);
    mockRedisClient.sadd.mockResolvedValue(1);
    mockRedisClient.srem.mockResolvedValue(1);
  });

  describe('addRepo', () => {
    it('should add a new repo and return added: true', async () => {
      // sadd returns 1 when element is newly added
      mockRedisClient.sadd.mockResolvedValue(1);

      const result = await addRepo('owner', 'repo');

      expect(result.added).toBe(true);
      expect(result.repo).toEqual({
        owner: 'owner',
        repo: 'repo',
        addedAt: expect.any(String),
      });
      expect(mockRedisClient.sadd).toHaveBeenCalledWith(
        'github:repos',
        expect.stringContaining('"owner":"owner"')
      );
    });

    it('should return added: false if repo already exists', async () => {
      // sadd returns 0 when element already exists in the set
      mockRedisClient.sadd.mockResolvedValue(0);

      const result = await addRepo('owner', 'repo');

      expect(result.added).toBe(false);
      expect(result.repo).toBeUndefined();
    });
  });

  describe('listRepos', () => {
    it('should return empty array when no repos exist', async () => {
      mockRedisClient.smembers.mockResolvedValue([]);

      const result = await listRepos();

      expect(result).toEqual([]);
    });

    it('should return all repos as parsed GitHubRepo objects', async () => {
      const repo1 = { owner: 'owner1', repo: 'repo1', addedAt: '2024-01-01T00:00:00Z' };
      const repo2 = { owner: 'owner2', repo: 'repo2', addedAt: '2024-01-02T00:00:00Z' };
      mockRedisClient.smembers.mockResolvedValue([
        JSON.stringify(repo1),
        JSON.stringify(repo2),
      ]);

      const result = await listRepos();

      expect(result).toEqual([repo1, repo2]);
    });

    it('should skip invalid JSON members', async () => {
      const repo1 = { owner: 'owner1', repo: 'repo1', addedAt: '2024-01-01T00:00:00Z' };
      mockRedisClient.smembers.mockResolvedValue(['invalid-json', JSON.stringify(repo1)]);

      const result = await listRepos();

      expect(result).toEqual([repo1]);
    });
  });

  describe('removeRepo', () => {
    it('should remove existing repo and return true', async () => {
      const existingRepo = { owner: 'owner', repo: 'repo', addedAt: '2024-01-01T00:00:00Z' };
      mockRedisClient.smembers.mockResolvedValue([JSON.stringify(existingRepo)]);

      const result = await removeRepo('owner', 'repo');

      expect(result).toBe(true);
      expect(mockRedisClient.srem).toHaveBeenCalledWith(
        'github:repos',
        JSON.stringify(existingRepo)
      );
    });

    it('should return false if repo does not exist', async () => {
      mockRedisClient.smembers.mockResolvedValue([]);

      const result = await removeRepo('owner', 'nonexistent');

      expect(result).toBe(false);
      expect(mockRedisClient.srem).not.toHaveBeenCalled();
    });

    it('should skip invalid JSON members when looking for repo to remove', async () => {
      const existingRepo = { owner: 'owner', repo: 'repo', addedAt: '2024-01-01T00:00:00Z' };
      mockRedisClient.smembers.mockResolvedValue(['invalid-json', JSON.stringify(existingRepo)]);

      const result = await removeRepo('owner', 'repo');

      expect(result).toBe(true);
    });
  });

  describe('repoExists', () => {
    it('should return true if repo exists', async () => {
      const existingRepo = { owner: 'owner', repo: 'repo', addedAt: '2024-01-01T00:00:00Z' };
      mockRedisClient.smembers.mockResolvedValue([JSON.stringify(existingRepo)]);

      const result = await repoExists('owner', 'repo');

      expect(result).toBe(true);
    });

    it('should return false if repo does not exist', async () => {
      mockRedisClient.smembers.mockResolvedValue([]);

      const result = await repoExists('owner', 'nonexistent');

      expect(result).toBe(false);
    });

    it('should return false if only owner matches but repo differs', async () => {
      const existingRepo = { owner: 'owner', repo: 'other-repo', addedAt: '2024-01-01T00:00:00Z' };
      mockRedisClient.smembers.mockResolvedValue([JSON.stringify(existingRepo)]);

      const result = await repoExists('owner', 'repo');

      expect(result).toBe(false);
    });
  });
});

describe('repos route plugin', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.resetAllMocks();
    server = Fastify({ logger: false });
    setRedisClient(mockRedisClient as unknown as Redis);

    // Import and register the route plugin
    const { reposRoute } = await import('./repos.js');
    await server.register(reposRoute);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe('GET /repos', () => {
    it('should return empty repos array when no repos exist', async () => {
      mockRedisClient.smembers.mockResolvedValue([]);

      const response = await server.inject({
        method: 'GET',
        url: '/repos',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.repos).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should return all repos', async () => {
      const repo1 = { owner: 'owner1', repo: 'repo1', addedAt: '2024-01-01T00:00:00Z' };
      const repo2 = { owner: 'owner2', repo: 'repo2', addedAt: '2024-01-02T00:00:00Z' };
      mockRedisClient.smembers.mockResolvedValue([
        JSON.stringify(repo1),
        JSON.stringify(repo2),
      ]);

      const response = await server.inject({
        method: 'GET',
        url: '/repos',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.repos).toHaveLength(2);
      expect(body.total).toBe(2);
    });
  });

  describe('POST /repos', () => {
    it('should add a new repo and return 201', async () => {
      // sadd returns 1 when element is newly added
      mockRedisClient.sadd.mockResolvedValue(1);

      const response = await server.inject({
        method: 'POST',
        url: '/repos',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: 'test-owner', repo: 'test-repo' }),
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.added).toBe(true);
      expect(body.repo).toEqual({
        owner: 'test-owner',
        repo: 'test-repo',
        addedAt: expect.any(String),
      });
    });

    it('should return 409 if repo already exists', async () => {
      // sadd returns 0 when element already exists in the set
      mockRedisClient.sadd.mockResolvedValue(0);

      const response = await server.inject({
        method: 'POST',
        url: '/repos',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: 'test-owner', repo: 'test-repo' }),
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Repository already registered');
    });

    it('should return 400 if owner is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/repos',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo: 'test-repo' }),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Missing owner or repo');
    });

    it('should return 400 if repo is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/repos',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: 'test-owner' }),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Missing owner or repo');
    });

    it('should return 400 if owner or repo is empty string', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/repos',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: '  ', repo: 'test-repo' }),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Owner and repo must be non-empty strings');
    });

    it('should return 400 for invalid owner format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/repos',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: 'invalid owner', repo: 'test-repo' }),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid owner or repo format');
    });

    it('should return 400 for invalid repo format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/repos',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: 'test-owner', repo: 'invalid repo' }),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid owner or repo format');
    });
  });

  describe('DELETE /repos/:owner/:repo', () => {
    it('should remove existing repo and return 200', async () => {
      const existingRepo = { owner: 'test-owner', repo: 'test-repo', addedAt: '2024-01-01T00:00:00Z' };
      mockRedisClient.smembers.mockResolvedValue([JSON.stringify(existingRepo)]);

      const response = await server.inject({
        method: 'DELETE',
        url: '/repos/test-owner/test-repo',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should return 404 if repo does not exist', async () => {
      mockRedisClient.smembers.mockResolvedValue([]);

      const response = await server.inject({
        method: 'DELETE',
        url: '/repos/nonexistent/repo',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Repository not found');
    });
  });
});