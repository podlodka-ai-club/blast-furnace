import Redis from 'ioredis';
import { config } from '../../config/index.js';
import { REPO_LIST_KEY } from '../../jobs/issue-watcher.js';
let redisClient = null;
function getRedisClient() {
    if (!redisClient) {
        redisClient = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            ...(config.redis.password !== undefined && { password: config.redis.password }),
        });
    }
    return redisClient;
}
export function setRedisClient(client) {
    redisClient = client;
}
export async function addRepo(owner, repo) {
    const client = getRedisClient();
    const newRepo = {
        owner,
        repo,
        addedAt: new Date().toISOString(),
    };
    const added = await client.sadd(REPO_LIST_KEY, JSON.stringify(newRepo));
    if (added === 0) {
        return { added: false };
    }
    return { added: true, repo: newRepo };
}
export async function listRepos() {
    const client = getRedisClient();
    const members = await client.smembers(REPO_LIST_KEY);
    const repos = [];
    for (const member of members) {
        try {
            repos.push(JSON.parse(member));
        }
        catch {
        }
    }
    return repos;
}
export async function removeRepo(owner, repo) {
    const client = getRedisClient();
    const members = await client.smembers(REPO_LIST_KEY);
    for (const member of members) {
        try {
            const parsed = JSON.parse(member);
            if (parsed.owner === owner && parsed.repo === repo) {
                await client.srem(REPO_LIST_KEY, member);
                return true;
            }
        }
        catch {
        }
    }
    return false;
}
export async function repoExists(owner, repo) {
    const client = getRedisClient();
    const members = await client.smembers(REPO_LIST_KEY);
    for (const member of members) {
        try {
            const parsed = JSON.parse(member);
            if (parsed.owner === owner && parsed.repo === repo) {
                return true;
            }
        }
        catch {
        }
    }
    return false;
}
export async function reposRoute(server, options) {
    if (options.redisClient) {
        redisClient = options.redisClient;
    }
    server.get('/repos', async (_request, _reply) => {
        const repos = await listRepos();
        return {
            repos,
            total: repos.length,
        };
    });
    server.post('/repos', async (request, reply) => {
        const body = request.body;
        if (!body?.owner || !body?.repo) {
            return reply.status(400).send({ error: 'Missing owner or repo' });
        }
        const owner = String(body.owner).trim();
        const repo = String(body.repo).trim();
        if (!owner || !repo) {
            return reply.status(400).send({ error: 'Owner and repo must be non-empty strings' });
        }
        if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
            return reply.status(400).send({ error: 'Invalid owner or repo format' });
        }
        const result = await addRepo(owner, repo);
        if (!result.added) {
            return reply.status(409).send({ error: 'Repository already registered' });
        }
        return reply.status(201).send(result);
    });
    server.delete('/repos/:owner/:repo', async (request, reply) => {
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
