import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
export async function processReview(job) {
    const logger = createJobLogger(job);
    const { issue, branchName, repoPath } = job.data;
    logger.info(`Reviewing issue #${issue.number} on branch ${branchName}`);
    const makePrJobData = {
        taskId: job.data.taskId,
        type: 'make-pr',
        issue,
        branchName,
        repoPath,
    };
    await jobQueue.add('make-pr', makePrJobData);
    logger.info(`Make PR job enqueued for branch: ${branchName}`);
}
export const reviewHandler = processReview;
