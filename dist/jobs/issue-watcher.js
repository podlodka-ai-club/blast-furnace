import { jobQueue } from './queue.js';
import { config } from '../config/index.js';
import { fetchIssues } from '../github/issues.js';
import Redis from 'ioredis';
const LAST_POLL_KEY = 'github:issue-watcher:last-poll';
export const REPO_LIST_KEY = 'github:repos';
const redisClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    ...(config.redis.password !== undefined && { password: config.redis.password }),
});
export async function startIssueWatcher() {
    const jobName = 'issue-watcher';
    let connectionEstablishedByThisCall = false;
    if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
        await redisClient.connect();
        connectionEstablishedByThisCall = true;
    }
    try {
        await jobQueue.add(jobName, {
            taskId: `issue-watcher-${Date.now()}`,
            type: 'issue-watcher',
        }, {
            repeat: {
                every: config.github.pollIntervalMs,
            },
            jobId: 'issue-watcher-repeatable',
        });
    }
    catch (err) {
        if (connectionEstablishedByThisCall) {
            await redisClient.quit();
        }
        throw err;
    }
}
export async function issueWatcherHandler(_job) {
    const storedTimestamp = await redisClient.get(LAST_POLL_KEY);
    const lastPollTimestamp = storedTimestamp ? new Date(storedTimestamp) : undefined;
    const sinceTimestamp = lastPollTimestamp?.toISOString();
    const repoMembers = await redisClient.smembers(REPO_LIST_KEY);
    const repos = [];
    for (const member of repoMembers) {
        try {
            const parsed = JSON.parse(member);
            if (parsed.owner && parsed.repo) {
                repos.push({ owner: parsed.owner, repo: parsed.repo });
            }
        }
        catch {
        }
    }
    if (repos.length === 0) {
        repos.push({ owner: config.github.owner, repo: config.github.repo });
    }
    for (const { owner, repo } of repos) {
        const issues = await fetchIssues({
            owner,
            repo,
            state: 'open',
            since: sinceTimestamp,
        });
        for (const issue of issues) {
            const processorJob = {
                taskId: `issue-processor-${issue.id}-${Date.now()}`,
                type: 'issue-processor',
                issue,
            };
            await jobQueue.add('issue-processor', processorJob);
        }
    }
    await redisClient.set(LAST_POLL_KEY, new Date().toISOString());
}
export async function closeIssueWatcherRedis() {
    if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
        await redisClient.quit();
    }
}
