import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
export async function processPlan(job) {
    const logger = createJobLogger(job);
    const { issue, branchName } = job.data;
    logger.info(`Planning issue #${issue.number} on branch ${branchName}`);
    const codexJobData = {
        taskId: job.data.taskId,
        type: 'codex-provider',
        issue,
        branchName,
    };
    await jobQueue.add('codex-provider', codexJobData);
    logger.info(`Codex provider job enqueued for branch: ${branchName}`);
}
export const planHandler = processPlan;
