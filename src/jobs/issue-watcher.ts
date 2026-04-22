import type { Job } from 'bullmq';
import type { IssueProcessorJobData, IssueWatcherJobData } from '../types/index.js';
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

/**
 * Start the issue watcher by adding a repeatable job to the queue.
 * The job will fire every pollIntervalMs milliseconds.
 */
export async function startIssueWatcher(): Promise<void> {
  const jobName = 'issue-watcher';

  let connectionEstablishedByThisCall = false;
  if (redisClient.status !== 'ready') {
    await redisClient.connect();
    connectionEstablishedByThisCall = true;
  }

  try {
    // Add a repeatable job - handler fetches lastPollTimestamp from Redis at runtime
    await jobQueue.add(
      jobName,
      {
        taskId: `issue-watcher-${Date.now()}`,
        type: 'issue-watcher',
      } as IssueWatcherJobData,
      {
        repeat: {
          every: config.github.pollIntervalMs,
        },
        jobId: 'issue-watcher-repeatable',
      }
    );
  } catch (err) {
    // If we established the connection and the operation failed, close the connection
    if (connectionEstablishedByThisCall) {
      await redisClient.quit();
    }
    throw err;
  }
}

/**
 * Handler for issue watcher jobs - fetches new issues and queues them for processing
 */
export async function issueWatcherHandler(_job: Job<IssueWatcherJobData>): Promise<void> {
  // Get lastPollTimestamp from Redis (not from job data, which is static for repeatable jobs)
  const storedTimestamp = await redisClient.get(LAST_POLL_KEY);
  const lastPollTimestamp = storedTimestamp ? new Date(storedTimestamp) : undefined;
  const sinceTimestamp = lastPollTimestamp?.toISOString();

  // Get list of registered repos from Redis
  const repoMembers = await redisClient.smembers(REPO_LIST_KEY);
  const repos: Array<{ owner: string; repo: string }> = [];

  for (const member of repoMembers) {
    try {
      const parsed = JSON.parse(member);
      if (parsed.owner && parsed.repo) {
        repos.push({ owner: parsed.owner, repo: parsed.repo });
      }
    } catch {
      // Skip invalid JSON members
    }
  }

  // If no repos registered, fall back to configured default repo
  if (repos.length === 0) {
    repos.push({ owner: config.github.owner, repo: config.github.repo });
  }

  // Fetch issues for each registered repo
  for (const { owner, repo } of repos) {
    const issues = await fetchIssues({
      owner,
      repo,
      state: 'open',
      since: sinceTimestamp,
    });

    // For each new issue, add an IssueProcessorJobData job to the queue
    for (const issue of issues) {
      const processorJob: IssueProcessorJobData = {
        taskId: `issue-processor-${issue.id}-${Date.now()}`,
        type: 'issue-processor',
        issue,
      };

      await jobQueue.add('issue-processor', processorJob);
    }
  }

  // Store current timestamp in Redis for next poll cycle
  await redisClient.set(LAST_POLL_KEY, new Date().toISOString());
}

/**
 * Close the issue watcher's Redis client
 */
export async function closeIssueWatcherRedis(): Promise<void> {
  if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
    await redisClient.quit();
  }
}