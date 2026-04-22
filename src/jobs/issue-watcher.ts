import type { IssueProcessorJobData, IssueWatcherJobData } from '../types/index.js';
import { jobQueue } from './queue.js';
import { config } from '../config/index.js';
import { fetchIssues } from '../github/issues.js';
import Redis from 'ioredis';

const LAST_POLL_KEY = 'github:issue-watcher:last-poll';
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
    // Add a repeatable job with no initial lastPollTimestamp
    // The handler will fetch all open issues on first run
    await jobQueue.add(
      jobName,
      {
        taskId: `issue-watcher-${Date.now()}`,
        type: 'issue-watcher',
        lastPollTimestamp: undefined,
      },
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

  // Fetch open issues, optionally filtered by last poll time
  const issues = await fetchIssues({
    state: 'open',
    since: lastPollTimestamp,
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