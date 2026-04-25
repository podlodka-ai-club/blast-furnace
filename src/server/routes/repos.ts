import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import Redis from 'ioredis';
import { config } from '../../config/index.js';
import { REPO_LIST_KEY } from '../../jobs/issue-watcher.js';
import type { GitHubRepo } from '../../types/index.js';

interface RepoRouteOptions extends FastifyPluginOptions {
  redisClient?: Redis;
}

let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      ...(config.redis.password !== undefined && { password: config.redis.password }),
    });
  }
  return redisClient;
}

export function setRedisClient(client: Redis): void {
  redisClient = client;
}

/**
 * Add a repository to the Redis set.
 * Returns { added: false } if the repo already exists.
 */
export async function addRepo(owner: string, repo: string): Promise<{ added: boolean; repo?: GitHubRepo }> {
  const client = getRedisClient();

  const newRepo: GitHubRepo = {
    owner,
    repo,
    addedAt: new Date().toISOString(),
  };

  // Use SADD return value to check if the repo was actually added
  // SADD returns 1 if the element was added, 0 if it already exists
  const added = await client.sadd(REPO_LIST_KEY, JSON.stringify(newRepo));

  if (added === 0) {
    return { added: false };
  }

  return { added: true, repo: newRepo };
}

/**
 * List all registered repositories.
 */
export async function listRepos(): Promise<GitHubRepo[]> {
  const client = getRedisClient();
  const members = await client.smembers(REPO_LIST_KEY);
  const repos: GitHubRepo[] = [];

  for (const member of members) {
    try {
      repos.push(JSON.parse(member) as GitHubRepo);
    } catch {
      // Skip invalid JSON members
    }
  }

  return repos;
}

/**
 * Remove a repository from the Redis set.
 * Returns true if the repo was removed, false if it didn't exist.
 */
export async function removeRepo(owner: string, repo: string): Promise<boolean> {
  const client = getRedisClient();
  const members = await client.smembers(REPO_LIST_KEY);

  for (const member of members) {
    try {
      const parsed = JSON.parse(member) as GitHubRepo;
      if (parsed.owner === owner && parsed.repo === repo) {
        await client.srem(REPO_LIST_KEY, member);
        return true;
      }
    } catch {
      // Skip invalid JSON members
    }
  }

  return false;
}

/**
 * Check if a repository exists in the Redis set.
 */
export async function repoExists(owner: string, repo: string): Promise<boolean> {
  const client = getRedisClient();
  const members = await client.smembers(REPO_LIST_KEY);

  for (const member of members) {
    try {
      const parsed = JSON.parse(member) as GitHubRepo;
      if (parsed.owner === owner && parsed.repo === repo) {
        return true;
      }
    } catch {
      // Skip invalid JSON members
    }
  }

  return false;
}

/**
 * Fastify route plugin for repository management
 */
export async function reposRoute(
  server: FastifyInstance,
  options: RepoRouteOptions
): Promise<void> {
  // Use provided redis client if available (for testing)
  if (options.redisClient) {
    redisClient = options.redisClient;
  }

  // GET /repos - List all repos
  server.get('/repos', async (_request, _reply) => {
    const repos = await listRepos();
    return {
      repos,
      total: repos.length,
    };
  });

  // POST /repos - Add a new repo
  server.post('/repos', async (request, reply) => {
    const body = request.body as { owner?: string; repo?: string } | undefined;

    if (!body?.owner || !body?.repo) {
      return reply.status(400).send({ error: 'Missing owner or repo' });
    }

    const owner = String(body.owner).trim();
    const repo = String(body.repo).trim();

    if (!owner || !repo) {
      return reply.status(400).send({ error: 'Owner and repo must be non-empty strings' });
    }

    // Validate owner/repo format (basic validation)
    if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
      return reply.status(400).send({ error: 'Invalid owner or repo format' });
    }

    const result = await addRepo(owner, repo);

    if (!result.added) {
      return reply.status(409).send({ error: 'Repository already registered' });
    }

    return reply.status(201).send(result);
  });

  // DELETE /repos/:owner/:repo - Remove a repo
  server.delete<{ Params: { owner: string; repo: string } }>('/repos/:owner/:repo', async (request, reply) => {
    const { owner, repo } = request.params;

    if (!owner || !repo) {
      return reply.status(400).send({ error: 'Missing owner or repo' });
    }

    const removed = await removeRepo(owner, repo);

    if (!removed) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    return reply.status(200).send({ success: true });
  });
}

export default reposRoute;