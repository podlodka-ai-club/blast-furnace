import type { Job } from 'bullmq';
import Redis from 'ioredis';
import type { IntakeJobData } from '../types/index.js';
import { config } from '../config/index.js';
import { fetchIssues } from '../github/issues.js';
import { READY_LABEL } from '../github/issue-labels.js';
import { jobQueue } from './queue.js';
import { createPrepareRunPayload } from './prepare-run.js';

const LAST_POLL_KEY = 'github:intake:last-poll';
const LEGACY_LAST_POLL_KEY = 'github:issue-watcher:last-poll';
export const REPO_LIST_KEY = 'github:repos';

const redisClient = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  ...(config.redis.password !== undefined && { password: config.redis.password }),
});

export async function startIntake(): Promise<void> {
  let connectionEstablishedByThisCall = false;
  if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
    await redisClient.connect();
    connectionEstablishedByThisCall = true;
  }

  try {
    const now = Date.now();
    const intakeJobData: IntakeJobData = {
      taskId: `intake-${now}`,
      type: 'intake',
      runId: `intake-${now}`,
      stage: 'intake',
      stageAttempt: 1,
      reworkAttempt: 0,
    };

    await jobQueue.add(
      'intake',
      intakeJobData,
      {
        repeat: {
          every: config.github.pollIntervalMs,
        },
        jobId: 'intake-repeatable',
      }
    );
  } catch (err) {
    if (connectionEstablishedByThisCall) {
      await redisClient.quit();
    }
    throw err;
  }
}

export async function intakeHandler(_job: Job<IntakeJobData>): Promise<void> {
  const storedTimestamp = await redisClient.get(LAST_POLL_KEY) ?? await redisClient.get(LEGACY_LAST_POLL_KEY);
  let sinceTimestamp: string | undefined;
  if (storedTimestamp) {
    const date = new Date(storedTimestamp);
    if (!Number.isNaN(date.getTime())) {
      sinceTimestamp = date.toISOString();
    }
  }

  const repoMembers = await redisClient.smembers(REPO_LIST_KEY);
  const repos: Array<{ owner: string; repo: string }> = [];

  for (const member of repoMembers) {
    try {
      const parsed = JSON.parse(member) as { owner?: unknown; repo?: unknown };
      if (typeof parsed.owner === 'string' && typeof parsed.repo === 'string') {
        repos.push({ owner: parsed.owner, repo: parsed.repo });
      }
    } catch {
      // Skip invalid JSON members.
    }
  }

  if (repos.length === 0) {
    repos.push({ owner: config.github.owner, repo: config.github.repo });
  }

  for (const repository of repos) {
    const issues = await fetchIssues({
      owner: repository.owner,
      repo: repository.repo,
      labels: READY_LABEL,
      state: 'open',
      since: sinceTimestamp,
    });

    for (const issue of issues) {
      await jobQueue.add('prepare-run', createPrepareRunPayload({ issue, repository }));
    }
  }

  await redisClient.set(LAST_POLL_KEY, new Date().toISOString());
}

export async function closeIntakeRedis(): Promise<void> {
  if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
    await redisClient.quit();
  }
}
