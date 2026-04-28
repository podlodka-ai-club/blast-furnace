import { moveIssueToInReview } from '../github/issue-labels.js';
import { assertConfiguredRepository } from '../github/repository.js';
import { cleanupWorkingDir } from '../utils/working-dir.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { resolveSyncTrackerStateContext } from './context-resolvers.js';
import { createJobLogger } from './logger.js';
import { appendHandoffRecordAndUpdateSummary, resolveOrchestrationStorageRoot, } from './orchestration.js';
async function readSyncTrackerStateInput(job) {
    stagePayloadSchemas['sync-tracker-state'].parse(job.data);
    return resolveSyncTrackerStateContext(job.data);
}
export async function runSyncTrackerStateWork(job, logger = createJobLogger(job), context) {
    const resolvedContext = context ?? await readSyncTrackerStateInput(job);
    const { issue, repository, branchName } = resolvedContext.runContext;
    const { pullRequest } = resolvedContext;
    assertConfiguredRepository(repository);
    logger.info(`Synchronizing tracker state for PR #${pullRequest.number} on branch ${branchName}`);
    let trackerLabels = [];
    try {
        trackerLabels = await moveIssueToInReview(issue.number);
        logger.info(`Issue #${issue.number} labels updated: ${trackerLabels.join(', ')}`);
    }
    catch (err) {
        logger.warn(`Failed to update labels for issue #${issue.number}: ${err}`);
    }
    const output = stageOutputSchemas['sync-tracker-state'].parse({
        status: 'tracker-synced',
        runId: job.data.runId,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        trackerLabels,
    });
    const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
    await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
        runId: job.data.runId,
        fromStage: 'sync-tracker-state',
        toStage: null,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn: [job.data.inputRecordRef],
        status: 'success',
        output,
    }, 'completed');
    return pullRequest;
}
export async function runSyncTrackerStateFlow(job) {
    const logger = createJobLogger(job);
    let workspacePath = null;
    try {
        const context = await readSyncTrackerStateInput(job);
        workspacePath = context.runContext.workspacePath;
        await runSyncTrackerStateWork(job, logger, context);
    }
    finally {
        if (workspacePath) {
            logger.info(`Cleaning up temp working directory: ${workspacePath}`);
            await cleanupWorkingDir(workspacePath);
        }
    }
}
export const syncTrackerStateHandler = runSyncTrackerStateFlow;
