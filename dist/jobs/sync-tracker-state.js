import { moveIssueToInReview } from '../github/issue-labels.js';
import { assertConfiguredRepository } from '../github/repository.js';
import { cleanupWorkingDir } from '../utils/working-dir.js';
import { createJobLogger } from './logger.js';
export async function runSyncTrackerStateWork(job, logger = createJobLogger(job)) {
    const { issue, repository, branchName, pullRequest } = job.data;
    assertConfiguredRepository(repository);
    logger.info(`Synchronizing tracker state for PR #${pullRequest.number} on branch ${branchName}`);
    try {
        const updatedLabels = await moveIssueToInReview(issue.number);
        logger.info(`Issue #${issue.number} labels updated: ${updatedLabels.join(', ')}`);
    }
    catch (err) {
        logger.warn(`Failed to update labels for issue #${issue.number}: ${err}`);
    }
    return pullRequest;
}
export async function runSyncTrackerStateFlow(job) {
    const logger = createJobLogger(job);
    try {
        await runSyncTrackerStateWork(job, logger);
    }
    finally {
        logger.info(`Cleaning up temp working directory: ${job.data.workspacePath}`);
        await cleanupWorkingDir(job.data.workspacePath);
    }
}
export const syncTrackerStateHandler = runSyncTrackerStateFlow;
