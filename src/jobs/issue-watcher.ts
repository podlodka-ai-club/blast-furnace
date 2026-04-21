import type { Job } from 'bullmq';
import type { IssueProcessorJobData, IssueWatcherJobData } from '../types/index.js';
import { jobQueue } from './queue.js';
import { config } from '../config/index.js';
import { fetchIssues } from '../github/issues.js';

/**
 * Start the issue watcher by adding a repeatable job to the queue.
 * The job will fire every pollIntervalMs milliseconds.
 */
export async function startIssueWatcher(): Promise<void> {
  const jobName = 'issue-watcher';

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
}

/**
 * Handler for issue watcher jobs - fetches new issues and queues them for processing
 */
export async function issueWatcherHandler(job: Job<IssueWatcherJobData>): Promise<void> {
  const { lastPollTimestamp } = job.data;

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

  // Note: BullMQ's repeatable job mechanism automatically reschedules this job.
  // The next invocation will use the same job data (lastPollTimestamp from initial job).
  // For accurate "since" filtering, consider storing last poll time in Redis.
}